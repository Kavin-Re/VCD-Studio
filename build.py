#!/usr/bin/env python3
"""Assembles the single-file index.html from src/ and embeds the demo dumps (raw-deflate + base64).

    python3 build.py           rebuild index.html
    python3 build.py --check   exit non-zero if index.html does not match src/ + demos/ (used by CI)
"""
import base64, hashlib, json, os, re, sys, zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

DEMOS = {
    "counter": dict(file="counter.vcd", title="Counter (8-bit up/down, x/z/runt demo)",
                    defaults=["tb_counter.clk", "tb_counter.rst_n", "tb_counter.en", "tb_counter.up", "tb_counter.q", "tb_counter.wrap", "tb_counter.bus"]),
    "fsm": dict(file="fsm.vcd", title="FSM (1011 sequence detector)",
                defaults=["tb_fsm.clk", "tb_fsm.rst_n", "tb_fsm.din", "tb_fsm.state", "tb_fsm.next_state", "tb_fsm.detected"]),
    "hop": dict(file="hop_engine.vcd", title="Keyed hop engine (FHSS-Link SipHash PRF)",
                defaults=["tb_hop_demo.clk", "tb_hop_demo.req", "tb_hop_demo.busy", "tb_hop_demo.valid", "tb_hop_demo.chan", "tb_hop_demo.dut.state", "tb_hop_demo.dut.v0"]),
}

def rd(n):
    with open(os.path.join(SRC, n), encoding="utf-8") as f:
        return f.read()

demos = {}
raw_total = z_total = 0
for k, m in DEMOS.items():
    with open(os.path.join(ROOT, "demos", m["file"]), "rb") as f:
        raw = f.read()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    z = c.compress(raw) + c.flush()
    raw_total += len(raw); z_total += len(z)
    demos[k] = dict(file=m["file"], title=m["title"], defaults=m["defaults"], z=base64.b64encode(z).decode())
js = "const DEMOS = " + json.dumps(demos, separators=(",", ":")) + ";\n" + rd("parser.js") + "\n" + rd("core.js") + "\n" + rd("ui.js")
assert "</script" not in js.lower()
html = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        "<title>VCD-Studio</title>\n<style>\n" + rd("style.css") + "</style>\n</head>\n<body>\n" + rd("body.html") + "<script>\n'use strict';\n" + js + "</script>\n</body>\n</html>\n")
out = os.path.join(ROOT, "index.html")


def _normalise(page):
    """Replace every embedded demo blob with a hash of its *inflated* bytes.

    Deflate output differs between zlib builds (zlib vs zlib-ng), so comparing the raw file
    byte-for-byte would give false alarms; the inflated payload is what matters.
    """
    def sub(m):
        raw = zlib.decompress(base64.b64decode(m.group(1)), -15)
        return '"z":"sha256:%s"' % hashlib.sha256(raw).hexdigest()
    return re.sub(r'"z":"([A-Za-z0-9+/=]+)"', sub, page)


if "--check" in sys.argv[1:]:
    # CI guard: fail if the committed index.html was not rebuilt after editing src/ or demos/.
    with open(out, encoding="utf-8", newline="") as f:
        committed = f.read()
    if _normalise(committed) != _normalise(html):
        sys.exit("index.html is stale: run `python3 build.py` and commit the result")
    print("index.html is up to date with src/ and demos/")
else:
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print("index.html: %d bytes; demos %d raw -> %d deflated bytes" % (len(html.encode()), raw_total, z_total))
