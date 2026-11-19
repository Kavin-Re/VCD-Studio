#!/usr/bin/env python3
"""vcd_stats.py - per-signal toggle counts and a crude switching-activity power proxy for a .vcd file.

Standard library only. Streams the file, so large dumps are fine (memory ~ number of signals).

Definitions (be careful, this is a *proxy*, not a power estimate):
  changes    number of value-change records that actually changed the stored value (the first sample of a
             signal, usually from $dumpvars, is its initial value and is not counted)
  toggles    sum over changes of the Hamming distance between old and new value, counting only
             bit positions that are 0/1 in both (a 0->1 or 1->0 flip)
  xz_events  number of changes where an x/z bit appeared, disappeared or changed kind (not in toggles)
  activity   toggles per bit per clock cycle (needs a clock: --clock NAME, or auto-detected)
  proxy      relative switching energy = sum(toggles * cap_weight), counting each VCD identifier ONCE
             (aliases of the same net across hierarchy levels are the same wire, not extra load)
  power_mW   only printed with --cap-ff/--vdd:  0.5 * C * Vdd^2 * toggles / sim_time.
             C is a flat per-bit capacitance YOU assume; glitch power, short-circuit power, leakage,
             clock tree and wire load are not modelled. Use it to compare two runs of the same design.
"""
import argparse
import json
import re
import sys

UNIT_S = {"s": 1.0, "ms": 1e-3, "us": 1e-6, "ns": 1e-9, "ps": 1e-12, "fs": 1e-15}


class Sig:
    __slots__ = ("path", "name", "width", "vtype", "ident", "stat")

    def __init__(self, path, name, width, vtype, ident, stat):
        self.path, self.name, self.width, self.vtype, self.ident, self.stat = path, name, width, vtype, ident, stat


class Stat:
    """Statistics for one VCD identifier (shared by all aliases)."""
    __slots__ = ("width", "cur_v", "cur_x", "cur_z", "changes", "toggles", "xz_events", "rises", "last_rise", "periods",
                 "last_t", "seen", "is_real")

    def __init__(self, width, is_real=False):
        self.width = width
        self.cur_v = 0      # known bits (0/1) as int
        self.cur_x = 0      # mask of x bits
        self.cur_z = 0      # mask of z bits
        self.changes = 0
        self.toggles = 0
        self.xz_events = 0
        self.rises = 0
        self.last_rise = None
        self.periods = []
        self.last_t = 0
        self.seen = False
        self.is_real = is_real


def parse_timescale(text):
    m = re.search(r"(\d+)\s*(fs|ps|ns|us|ms|s)", text)
    if not m:
        return 1, "ns"
    return int(m.group(1)), m.group(2)


def bits_to_masks(bits, width):
    """'01xz' string (MSB first, possibly shorter than width) -> (value, xmask, zmask) with Verilog left-extension."""
    bits = bits.lower()
    if len(bits) < width:
        ext = bits[0] if bits and bits[0] in "xz" else "0"
        bits = ext * (width - len(bits)) + bits
    elif len(bits) > width:
        bits = bits[-width:]
    v = x = z = 0
    for ch in bits:
        v <<= 1
        x <<= 1
        z <<= 1
        if ch == "1":
            v |= 1
        elif ch == "z":
            z |= 1
        elif ch != "0":      # x, u, w, -, anything else: unknown
            x |= 1
    return v, x, z


def apply_change(st, t, v, x, z):
    """Update one Stat with a new value at time t. Returns True if the stored value changed."""
    if st.seen and v == st.cur_v and x == st.cur_x and z == st.cur_z:
        return False
    if st.seen:
        known = ~(st.cur_x | st.cur_z) & ~(x | z)
        st.toggles += bin((st.cur_v ^ v) & known).count("1")
        if (st.cur_x, st.cur_z) != (x, z):
            st.xz_events += 1
        if st.width == 1:       # rising edge bookkeeping for clock detection
            was0 = not (st.cur_v & 1) and not (st.cur_x | st.cur_z)
            now1 = (v & 1) and not (x | z)
            if was0 and now1:
                st.rises += 1
                if st.last_rise is not None:
                    st.periods.append(t - st.last_rise)
                st.last_rise = t
        st.changes += 1
    st.cur_v, st.cur_x, st.cur_z = v, x, z
    st.last_t = t
    st.seen = True
    return True


def parse_vcd(stream):
    """Parse a VCD from a text stream. Returns dict(signals=[Sig], stats={id: Stat}, timescale=(mag, unit), t_end, t_start)."""
    scope = []
    signals = []
    stats = {}
    ts_text = ""
    in_header = True
    cmd = None
    args = []
    t = 0
    t_start = None
    t_end = 0
    pending_vec = None  # ('b'|'r', payload)
    for line in stream:
        for tok in line.split():
            if in_header or cmd is not None:
                if tok.startswith("$") and tok != "$end" and cmd is None:
                    cmd = tok[1:]
                    args = []
                    if not in_header and cmd in ("dumpvars", "dumpall", "dumpon", "dumpoff"):
                        cmd = "__values__"
                    continue
                if tok == "$end" and cmd is not None:
                    if cmd == "scope" and len(args) >= 2:
                        scope.append(args[1])
                    elif cmd == "upscope" and scope:
                        scope.pop()
                    elif cmd == "timescale":
                        ts_text = " ".join(args)
                    elif cmd == "var" and len(args) >= 4:
                        vtype, width, ident, name = args[0], int(args[1]), args[2], args[3]
                        if len(args) > 4 and width == 1 and re.fullmatch(r"\[\d+\]", args[4]):
                            name += args[4]
                        st = stats.get(ident)
                        if st is None:
                            st = stats[ident] = Stat(width, vtype in ("real", "realtime"))
                        signals.append(Sig(".".join(scope + [name]), name, width, vtype, ident, st))
                    elif cmd == "enddefinitions":
                        in_header = False
                    cmd = None
                    continue
                if cmd != "__values__":
                    args.append(tok)
                    continue
                # __values__: fall through to value handling
            if pending_vec is not None:
                kind, payload = pending_vec
                pending_vec = None
                st = stats.get(tok)
                if st is not None and kind == "b":
                    apply_change(st, t, *bits_to_masks(payload, st.width))
                elif st is not None and kind == "r":
                    try:
                        val = float(payload)
                    except ValueError:
                        val = 0.0
                    if not st.seen or val != st.cur_v:
                        if st.seen:
                            st.changes += 1       # real values: counted as changes, never as bit toggles
                        st.cur_v, st.seen, st.last_t = val, True, t
                continue
            c = tok[0]
            if c == "#":
                try:
                    t = int(tok[1:])
                except ValueError:
                    continue
                if t_start is None:
                    t_start = t
                t_end = max(t_end, t)
            elif c in "bB":
                pending_vec = ("b", tok[1:])
            elif c in "rR":
                pending_vec = ("r", tok[1:])
            elif c in "sS":
                pending_vec = ("s", tok[1:])
            elif c in "01xXzZuUwWlLhH-":
                st = stats.get(tok[1:])
                if st is not None:
                    apply_change(st, t, *bits_to_masks(c, 1))
    mag, unit = parse_timescale(ts_text)
    return {"signals": signals, "stats": stats, "timescale": (mag, unit), "t_end": t_end, "t_start": t_start or 0}


def detect_clock(sigs):
    """Pick the 1-bit signal with the most rising edges and a regular period (coefficient of variation < 5%)."""
    best = None
    for s in sigs:
        st = s.stat
        if s.width != 1 or len(st.periods) < 4:
            continue
        mean = sum(st.periods) / len(st.periods)
        if mean <= 0:
            continue
        var = sum((p - mean) ** 2 for p in st.periods) / len(st.periods)
        cv = (var ** 0.5) / mean
        if cv < 0.05 and (best is None or len(st.periods) > len(best.stat.periods)):
            best = s
    return best


def analyse(info, scope_filter=None, clock=None, cap_ff=None, vdd=1.0):
    sigs = info["signals"]
    if scope_filter:
        sigs = [s for s in sigs if s.path.startswith(scope_filter)]
    clk = None
    if clock:
        for s in info["signals"]:
            if s.path == clock or s.name == clock or s.path.endswith("." + clock):
                clk = s
                break
        if clk is None:
            raise SystemExit("clock signal %r not found" % clock)
    else:
        clk = detect_clock(info["signals"])
    mag, unit = info["timescale"]
    sim_time = (info["t_end"] - info["t_start"]) * mag * UNIT_S[unit]
    cycles = None
    period_s = None
    if clk is not None and clk.stat.periods:
        period_s = sum(clk.stat.periods) / len(clk.stat.periods) * mag * UNIT_S[unit]
        cycles = max(1, clk.stat.rises)
    rows = []
    seen_ids = set()
    total_toggles = 0
    for s in sigs:
        st = s.stat
        first = s.ident not in seen_ids       # count each net once in the totals
        seen_ids.add(s.ident)
        if st.is_real or s.vtype == "parameter":
            continue
        row = {"signal": s.path, "width": s.width, "changes": st.changes, "toggles": st.toggles, "xz_events": st.xz_events,
               "activity": (st.toggles / (s.width * cycles)) if cycles else None, "alias": not first}
        rows.append(row)
        if first:
            total_toggles += st.toggles
    out = {"timescale": "%d%s" % (mag, unit), "t_start": info["t_start"], "t_end": info["t_end"], "sim_time_s": sim_time,
           "clock": clk.path if clk else None, "clock_period_s": period_s, "clock_cycles": cycles,
           "signals": rows, "total_toggles": total_toggles, "proxy_weighted_toggles": float(total_toggles)}
    if cycles:
        out["proxy_toggles_per_cycle"] = total_toggles / cycles
    if cap_ff is not None and sim_time > 0:
        out["power_mW"] = 0.5 * cap_ff * 1e-15 * vdd ** 2 * total_toggles / sim_time * 1e3
        out["assumptions"] = {"cap_ff_per_bit": cap_ff, "vdd": vdd}
    return out


def render_table(res, top=None, sort="toggles"):
    rows = [r for r in res["signals"]]
    rows.sort(key=lambda r: (-r[sort] if isinstance(r[sort], (int, float)) else 0, r["signal"]))
    if top:
        rows = rows[:top]
    w = max([len(r["signal"]) for r in rows] + [6])
    lines = []
    lines.append("timescale %s   span %d..%d   sim time %.6g s" % (res["timescale"], res["t_start"], res["t_end"], res["sim_time_s"]))
    if res["clock"]:
        lines.append("clock     %s   period %.6g s (%.6g MHz)   rising edges %d" % (
            res["clock"], res["clock_period_s"], 1e-6 / res["clock_period_s"], res["clock_cycles"]))
    else:
        lines.append("clock     none detected (use --clock NAME for activity per cycle)")
    lines.append("")
    lines.append("%-*s %5s %9s %9s %6s %9s" % (w, "signal", "width", "changes", "toggles", "xz", "activity"))
    for r in rows:
        act = "-" if r["activity"] is None else "%.4f" % r["activity"]
        lines.append("%-*s %5d %9d %9d %6d %9s%s" % (w, r["signal"], r["width"], r["changes"], r["toggles"], r["xz_events"], act,
                                                   "  (alias)" if r["alias"] else ""))
    lines.append("")
    lines.append("total bit toggles (aliases counted once) : %d" % res["total_toggles"])
    if "proxy_toggles_per_cycle" in res:
        lines.append("switching-activity proxy                 : %.3f weighted toggles / clock cycle" % res["proxy_toggles_per_cycle"])
    if "power_mW" in res:
        a = res["assumptions"]
        lines.append("dynamic power proxy                      : %.6g mW  (assumes %.3g fF/bit, Vdd %.3g V; ignores glitch/leakage/clock tree)" % (
            res["power_mW"], a["cap_ff_per_bit"], a["vdd"]))
    lines.append("This is a relative proxy for comparing runs of the same design, not a power estimate.")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Per-signal toggle counts and a crude switching-activity power proxy for a VCD file.")
    ap.add_argument("vcd")
    ap.add_argument("--scope", help="only report signals whose path starts with this prefix, e.g. tb.dut")
    ap.add_argument("--clock", help="clock signal (path or name) used to normalise activity; auto-detected if omitted")
    ap.add_argument("--cap-ff", type=float, help="assumed capacitance per bit in fF; enables the mW proxy")
    ap.add_argument("--vdd", type=float, default=1.0, help="supply voltage for the mW proxy (default 1.0)")
    ap.add_argument("--top", type=int, help="show only the N most active signals")
    ap.add_argument("--sort", default="toggles", choices=["toggles", "changes", "activity", "xz_events"])
    ap.add_argument("--json", action="store_true", help="print JSON instead of a table")
    a = ap.parse_args(argv)
    with open(a.vcd, "r", errors="replace") as f:
        info = parse_vcd(f)
    res = analyse(info, a.scope, a.clock, a.cap_ff, a.vdd)
    if a.json:
        json.dump(res, sys.stdout, indent=1)
        print()
    else:
        print(render_table(res, a.top, a.sort))
    return 0


if __name__ == "__main__":
    sys.exit(main())
