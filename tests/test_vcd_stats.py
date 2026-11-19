import io
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import vcd_stats as vs  # noqa: E402

SMALL = """$timescale 10 ns $end
$scope module top $end
$var wire 1 ! clk $end
$var wire 4 " bus [3:0] $end
$scope module u $end
$var wire 1 ! clk $end
$var wire 4 " bus [3:0] $end
$upscope $end
$var wire 1 # d $end
$var real 64 $ r $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
0!
b0000 "
x#
r0.5 $
$end
#5
1!
b0011 "
0#
#10
0!
b1x01 "
#15
1!
b1101 "
1#
#20
0!
r1.5 $
"""


def run(text, **kw):
    info = vs.parse_vcd(io.StringIO(text))
    return info, vs.analyse(info, **kw)


class TestParse(unittest.TestCase):
    def test_header(self):
        info, _ = run(SMALL)
        self.assertEqual(info["timescale"], (10, "ns"))
        self.assertEqual([s.path for s in info["signals"]],
                         ["top.clk", "top.bus", "top.u.clk", "top.u.bus", "top.d", "top.r"])
        self.assertEqual(info["t_end"], 20)

    def test_masks(self):
        self.assertEqual(vs.bits_to_masks("1x01", 4), (0b1001, 0b0100, 0))
        self.assertEqual(vs.bits_to_masks("z", 4), (0, 0, 0b1111))     # z extends
        self.assertEqual(vs.bits_to_masks("x1", 4), (1, 0b1110, 0))    # x extends: "x1" -> "xxx1"
        self.assertEqual(vs.bits_to_masks("1", 4), (1, 0, 0))          # 0 extends

    def test_counts(self):
        _, res = run(SMALL)
        by = {r["signal"]: r for r in res["signals"]}
        self.assertEqual(by["top.clk"]["changes"], 4)
        self.assertEqual(by["top.clk"]["toggles"], 4)
        # bus: 0000->0011 (2) ->1x01 : known bits 3,1,0: 0->1(b3) 1->0(b1) 1->1 => 2 flips, 1 xz event
        #      ->1101 : known bits 3,1,0 now all known; old x bit not counted; b1 0->0, b0 1->1, b3 1->1 => 0, xz event
        self.assertEqual(by["top.bus"]["toggles"], 2 + 2 + 0)
        self.assertEqual(by["top.bus"]["xz_events"], 2)
        self.assertEqual(by["top.bus"]["changes"], 3)
        # d: x -> 0 -> 1 : xz event then one toggle? x->0 has no known-before bit, so toggles = 1 (0->1)
        self.assertEqual(by["top.d"]["toggles"], 1)
        self.assertEqual(by["top.d"]["xz_events"], 1)
        self.assertNotIn("top.r", by)                                  # reals are skipped

    def test_alias_counted_once(self):
        _, res = run(SMALL)
        by = {r["signal"]: r for r in res["signals"]}
        self.assertTrue(by["top.u.clk"]["alias"])
        self.assertEqual(by["top.u.clk"]["toggles"], by["top.clk"]["toggles"])
        # clk(4) + bus(4) + d(1), aliases not added again
        self.assertEqual(res["total_toggles"], 4 + 4 + 1)

    def test_clock_detect_and_power(self):
        info, res = run(SMALL, cap_ff=10.0, vdd=1.0)
        self.assertIsNone(res["clock"])                                # only 2 rising edges: too few to call it a clock
        info, res = run(SMALL, clock="clk", cap_ff=10.0, vdd=1.0)
        self.assertEqual(res["clock_cycles"], 2)
        self.assertAlmostEqual(res["clock_period_s"], 10 * 10e-9)
        sim_time = 20 * 10e-9
        self.assertAlmostEqual(res["power_mW"], 0.5 * 10e-15 * 9 / sim_time * 1e3)

    def test_scope_filter(self):
        _, res = run(SMALL, scope_filter="top.u")
        self.assertEqual({r["signal"] for r in res["signals"]}, {"top.u.clk", "top.u.bus"})

    def test_missing_clock(self):
        info = vs.parse_vcd(io.StringIO(SMALL))
        with self.assertRaises(SystemExit):
            vs.analyse(info, clock="nope")


class TestOnRealDumps(unittest.TestCase):
    """Dumps produced by iverilog (demos/), with exact expectations derived from the design."""

    def load(self, name, **kw):
        with open(os.path.join(ROOT, "demos", name)) as f:
            info = vs.parse_vcd(f)
        return info, vs.analyse(info, **kw)

    def test_counter_matches_binary_counting_identity(self):
        # Free-running segments of an up counter: total LSB..MSB flips from value a to b is sum of Hamming steps.
        # Check the global invariant instead: toggles(q) == sum over consecutive q values of popcount(prev ^ next).
        info, res = self.load("counter.vcd")
        seq = []
        cur = {}
        t = None
        with open(os.path.join(ROOT, "demos", "counter.vcd")) as f:
            body = f.read().split("$enddefinitions")[1]
        qid = [s.ident for s in info["signals"] if s.path == "tb_counter.dut.q"][0]
        toks = body.split()
        i = 0
        while i < len(toks):
            tk = toks[i]
            if tk[0] == "b" and i + 1 < len(toks) and toks[i + 1] == qid:
                seq.append(tk[1:])
                i += 1
            i += 1
        exp = 0
        prev = None
        for b in seq:
            if "x" in b or "z" in b:
                prev = None
                continue
            val = int(b, 2)
            if prev is not None:
                exp += bin(prev ^ val).count("1")
            prev = val
        by = {r["signal"]: r for r in res["signals"]}
        self.assertEqual(by["tb_counter.dut.q"]["toggles"], exp)
        self.assertEqual(by["tb_counter.dut.q"]["xz_events"], 1)       # x until first reset edge
        self.assertEqual(res["clock"], "tb_counter.clk")
        self.assertAlmostEqual(res["clock_period_s"], 10e-9, places=15)

    def test_counter_clock_toggles(self):
        _, res = self.load("counter.vcd")
        by = {r["signal"]: r for r in res["signals"]}
        # 1783 ns run, 10 ns period, first edge at 5 ns: clk toggles at 5,10,...,1780 ns
        self.assertEqual(by["tb_counter.clk"]["toggles"], 356)

    def test_fsm_and_hop_parse(self):
        info, res = self.load("fsm.vcd", scope_filter="tb_fsm.dut")
        by = {r["signal"]: r for r in res["signals"]}
        self.assertGreater(by["tb_fsm.dut.state"]["toggles"], 10)
        info, res = self.load("hop_engine.vcd", scope_filter="tb_hop_demo.dut")
        self.assertGreater(res["total_toggles"], 1000)                 # SipRound mixes ~half of 256 state bits per clock

    def test_cli_json_and_table(self):
        out = subprocess.run([sys.executable, os.path.join(ROOT, "vcd_stats.py"), os.path.join(ROOT, "demos", "fsm.vcd"), "--top", "3"],
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("toggles", out.stdout)
        out = subprocess.run([sys.executable, os.path.join(ROOT, "vcd_stats.py"), os.path.join(ROOT, "demos", "fsm.vcd"), "--json"],
                             capture_output=True, text=True)
        import json
        self.assertIn("signals", json.loads(out.stdout))


if __name__ == "__main__":
    unittest.main()
