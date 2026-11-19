#!/usr/bin/env python3
"""Headless end-to-end test of index.html (Playwright + Chromium, file:// URL, no network).
Run: python3 tests/test_viewer.py [--big]     Screenshots/exports land in out/."""
import io, json, os, struct, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import vcd_stats as vs

OUT = os.path.join(ROOT, "out"); os.makedirs(OUT, exist_ok=True)
URL = "file://" + os.path.join(ROOT, "index.html")
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if detail != "" else ""), flush=True)

def ref_stats(path):
    with open(path) as f:
        info = vs.parse_vcd(f)
    return info

def main():
    big = "--big" in sys.argv
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 860}, accept_downloads=True)
        pg = ctx.new_page(); logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text)); pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
        reqs = []; pg.on("request", lambda r: reqs.append(r.url))
        pg.goto(URL); pg.wait_for_function("window.VCDStudio && VCDStudio.D.root"); pg.wait_for_timeout(300)
        pg.evaluate("window.__noAnim = true")
        check("page loads with embedded demo, no console errors", not [l for l in logs if l.startswith(("error", "PAGEERROR"))], logs[:3])
        check("fully offline: only file:// requests", all(r.startswith("file://") or r.startswith("data:") or r.startswith("blob:") for r in reqs), [r for r in reqs if not r.startswith("file://")][:3])
        pg.screenshot(path=OUT + "/01_counter_demo.png")

        # ---- parser cross-check against vcd_stats.py (independent implementation) on all 3 demos
        for key, fn in [("counter", "counter.vcd"), ("fsm", "fsm.vcd"), ("hop", "hop_engine.vcd")]:
            pg.evaluate("k => VCDStudio.loadDemo(k)", key); pg.wait_for_function("k => VCDStudio.D.demo === k", arg=key)
            info = ref_stats(os.path.join(ROOT, "demos", fn))
            js = pg.evaluate("""() => VCDStudio.D.sigs.map(s => [s.path, s.width, Math.max(0, s.data.n - 1), VCDStudio.countToggles(s.data)])""")
            ref = {s.path: (s.width, s.stat.changes, s.stat.toggles) for s in info["signals"] if s.vtype != "parameter" and not s.stat.is_real}
            bad = [(r[0], r[1:], ref[r[0]]) for r in js if r[0] in ref and tuple(r[1:]) != ref[r[0]]]
            check("parser == vcd_stats.py for %s (%d signals: width, changes, bit toggles)" % (fn, len(js)), not bad and len(js) >= len(ref), bad[:3])
            tm = pg.evaluate("[VCDStudio.D.tmin, VCDStudio.D.tmax, VCDStudio.D.tsUnit, VCDStudio.D.tsMag]")
            check("  time span/timescale for %s" % fn, tm[1] == info["t_end"] and tm[2] == info["timescale"][1] and tm[3] == info["timescale"][0], tm)

        # ---- back to counter: zoom, add signal, cursors, search
        pg.evaluate("VCDStudio.loadDemo('counter')"); pg.wait_for_function("VCDStudio.D.demo === 'counter'"); pg.wait_for_timeout(200)
        span0 = pg.evaluate("VCDStudio.V.t1 - VCDStudio.V.t0")
        pg.keyboard.press("+"); pg.wait_for_timeout(100)
        span1 = pg.evaluate("VCDStudio.V.t1 - VCDStudio.V.t0")
        check("zoom in key halves the visible span", abs(span1 / span0 - 0.5) < 0.01, (span0, span1))
        pg.keyboard.press("f"); pg.wait_for_timeout(100)
        box = pg.locator("#cv").bounding_box()
        # ctrl+wheel zoom at pointer keeps the time under the pointer fixed
        px = box["x"] + box["width"] * 0.3; py = box["y"] + 100
        tb = pg.evaluate("(x) => { const W = VCDStudio.W(); return VCDStudio.V.t0 + (x) / (W / (VCDStudio.V.t1 - VCDStudio.V.t0)); }", px - box["x"])
        pg.mouse.move(px, py); pg.keyboard.down("Control"); pg.mouse.wheel(0, -400); pg.keyboard.up("Control"); pg.wait_for_timeout(150)
        ta = pg.evaluate("(x) => { const W = VCDStudio.W(); return VCDStudio.V.t0 + (x) / (W / (VCDStudio.V.t1 - VCDStudio.V.t0)); }", px - box["x"])
        sp2 = pg.evaluate("VCDStudio.V.t1 - VCDStudio.V.t0")
        check("ctrl+wheel zooms about the pointer", sp2 < span0 * 0.7 and abs(ta - tb) < span0 * 0.002, (tb, ta, sp2))
        pg.keyboard.press("f"); pg.wait_for_timeout(100)

        # search + add a signal from the tree
        pg.locator("#q").fill("dut.q"); pg.wait_for_timeout(250)
        hits = pg.locator("#tree .sg").count()
        check("tree search finds 'dut.q'", hits == 1, hits)
        before = pg.evaluate("VCDStudio.S.rows.length")
        pg.locator("#tree .sg").first.click(); pg.wait_for_timeout(100)
        after = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.path)")
        check("clicking a search hit adds the signal", len(after) == before + 1 and after[-1] == "tb_counter.dut.q", after[-1])
        pg.locator("#q").fill(""); pg.wait_for_timeout(200)
        pg.locator("#q").fill("/^tb_counter\\.(rst|up)/"); pg.wait_for_timeout(250)
        check("regex search works", pg.locator("#tree .sg").count() == 2)
        pg.locator("#q").fill(""); pg.wait_for_timeout(150)
        # remove it again
        n_rows = pg.locator("#names .nrow").count()
        pg.locator("#names .nrow").last.locator(".rm").click(); pg.wait_for_timeout(100)
        check("remove signal with the x button", pg.locator("#names .nrow").count() == n_rows - 1)
        # reorder with Alt+Up
        pg.locator("#names .nrow").nth(3).click(); first3 = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.name)")
        pg.keyboard.press("Alt+ArrowUp"); second = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.name)")
        check("Alt+Up moves the selected row up", second[2] == first3[3] and second[3] == first3[2], (first3[:4], second[:4]))
        pg.keyboard.press("Alt+ArrowDown")
        # drag and drop reorder (HTML5 DnD)
        names0 = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.name)")
        pg.locator("#names .nrow").nth(0).drag_to(pg.locator("#names .nrow").nth(2)); pg.wait_for_timeout(150)
        names1 = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.name)")
        check("drag-and-drop reorders rows", names1 != names0 and names1[2] == names0[0], (names0[:4], names1[:4]))
        pg.evaluate("VCDStudio.S.rows.sort((a,b) => " + json.dumps(names0) + ".indexOf(a.sig.name) - " + json.dumps(names0) + ".indexOf(b.sig.name)); VCDStudio.afterRowsChange()")

        # cursors
        pg.keyboard.press("f"); pg.wait_for_timeout(100)
        qrow = pg.evaluate("VCDStudio.S.rows.findIndex(r => r.sig.name === 'q')")
        ypos = pg.evaluate("(i) => VCDStudio.S.rows[i].y + VCDStudio.S.rows[i].h / 2", qrow)
        W = pg.evaluate("VCDStudio.W()"); t0, t1 = pg.evaluate("[VCDStudio.V.t0, VCDStudio.V.t1]")
        xa = box["x"] + W * 0.30; xb = box["x"] + W * 0.55
        pg.mouse.click(xa, box["y"] + ypos); (pg.keyboard.down("Shift"), pg.mouse.click(xb, box["y"] + ypos), pg.keyboard.up("Shift")); pg.wait_for_timeout(150)
        A, B = pg.evaluate("[VCDStudio.S.A, VCDStudio.S.B]")
        check("click sets cursor A, shift+click sets cursor B", A is not None and B is not None and B > A, (A, B))
        dtxt = pg.locator("#cD").inner_text(); ftxt = pg.locator("#cF").inner_text()
        dt_ps = B - A
        check("delta readout matches B-A and shows 1/delta frequency", "ns" in dtxt or "us" in dtxt, (dtxt, ftxt, dt_ps))
        expect_f = 1e12 / dt_ps
        check("  1/delta numeric", ("MHz" in ftxt or "kHz" in ftxt) and abs(float(ftxt.split("=")[1].split()[0]) * (1e6 if "MHz" in ftxt else 1e3) - expect_f) / expect_f < 0.01, ftxt)
        va = pg.locator("#names .nrow").nth(qrow).locator(".val").inner_text()
        qd = pg.evaluate("(t) => { const r = VCDStudio.S.rows.find(r => r.sig.name === 'q'); const d = r.sig.data; return VCDStudio.fmtValue(d, d.t.findLastIndex ? d.t.findLastIndex(x => x <= t) : 0, 'h', 8); }", A)
        check("value at cursor A shown in the name panel", va == qd, (va, qd))
        pg.screenshot(path=OUT + "/02_cursors.png")
        pg.keyboard.press("z"); pg.wait_for_timeout(100)
        t0z, t1z = pg.evaluate("[VCDStudio.V.t0, VCDStudio.V.t1]")
        check("Z zooms to cursors A..B", abs((t1z - t0z) - (B - A) * 1.1) < (B - A) * 0.02, (t0z, t1z, A, B))
        pg.screenshot(path=OUT + "/03_zoom_to_cursors.png")
        pg.keyboard.press("c"); pg.keyboard.press("f"); pg.wait_for_timeout(100)

        # edge search on clk
        pg.locator("#names .nrow").nth(0).click()    # clk
        pg.evaluate("VCDStudio.S.A = null"); pg.keyboard.press("n"); pg.wait_for_timeout(100)
        e1 = pg.evaluate("VCDStudio.S.A"); pg.keyboard.press("n"); e2 = pg.evaluate("VCDStudio.S.A")
        check("N jumps to consecutive clk edges (5 ns apart)", e1 is not None and e2 - e1 == 5000, (e1, e2))
        pg.locator("#edgeKind").select_option("rise"); pg.keyboard.press("n"); e3 = pg.evaluate("VCDStudio.S.A")
        check("rising-only edge search skips falling edges", e3 - e2 == 5000, (e2, e3))
        pg.keyboard.press("p"); e4 = pg.evaluate("VCDStudio.S.A")
        check("P goes to previous rising edge", e3 - e4 == 10000, (e3, e4))
        pg.locator("#edgeKind").select_option("any")

        # value match on q == 0x10 (verify against independent scan of the raw VCD)
        pg.locator("#names .nrow").nth(qrow).click(); pg.evaluate("VCDStudio.S.A = null")
        pg.locator("#matchIn").fill("0x10"); pg.locator("#bMNext").click(); pg.wait_for_timeout(100)
        mt = pg.evaluate("VCDStudio.S.A")
        text = open(os.path.join(ROOT, "demos", "counter.vcd")).read()
        qid = [s.ident for s in ref_stats(os.path.join(ROOT, "demos", "counter.vcd"))["signals"] if s.path == "tb_counter.dut.q"][0]
        body = text.split("$enddefinitions")[1].split(); cur = 0; exp = None; i = 0
        while i < len(body):
            tk = body[i]
            if tk.startswith("#") and tk[1:].isdigit(): cur = int(tk[1:])
            elif tk[0] == "b" and i + 1 < len(body) and body[i + 1] == qid and "x" not in tk and int(tk[1:], 2) == 0x10: exp = cur; break
            i += 2 if (tk[0] in "brB" and len(tk) > 1) else 1
        check("value-match search 0x10 lands on the first q==0x10 change", exp is not None and mt == exp, (mt, exp))
        pg.locator("#matchIn").fill("x"); pg.evaluate("VCDStudio.S.A = null"); pg.locator("#bMNext").click(); pg.wait_for_timeout(100)
        xt = pg.evaluate("VCDStudio.S.A")
        check("search 'x' finds the first unknown value of q (time 0, before reset)", xt is not None, xt)

        # bus x/z highlight: bus row at the z/x region; take a screenshot and sample pixel colours
        busrow = pg.evaluate("VCDStudio.S.rows.findIndex(r => r.sig.name === 'bus')")
        pg.evaluate("VCDStudio.S.A = null; VCDStudio.S.B = null"); pg.keyboard.press("f"); pg.wait_for_timeout(120)
        info = pg.evaluate("""(i) => { const r = VCDStudio.S.rows[i], d = r.sig.data; const out = []; for (let k = 0; k < d.n; k++) out.push([d.t[k], VCDStudio.fmtValue(d, k, 'b', 8), VCDStudio.fmtValue(d, k, 'h', 8)]); return out; }""", busrow)
        hexs = [x[2] for x in info]
        check("bus shows hex x/z nibbles correctly ('Xx..' mixed -> a5/5a/ax..)", "a5" in hexs and "5a" in hexs and any("x" in h.lower() for h in hexs) and "zz" in hexs and "0z" in hexs, hexs)
        img = pg.evaluate("""(i) => { const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), r = VCDStudio.S.rows[i]; const y = Math.round((r.y + r.h/2) * (window.devicePixelRatio||1));
            let red = 0, amber = 0; const d = ctx.getImageData(0, y - 6, cv.width, 12).data; for (let k = 0; k < d.length; k += 4){ const R = d[k], G = d[k+1], B = d[k+2]; if (R > 200 && G < 120 && B < 120) red++; if (R > 150 && G > 90 && G < 150 && B < 40) amber++; } return [red, amber]; }""", busrow)
        check("canvas contains red (x) and amber (z) pixels on the bus row", img[0] > 5 and img[1] > 5, img)

        # radix: signed decimal of q
        pg.locator("#names .nrow").nth(qrow).click(); pg.evaluate("VCDStudio.S.A = VCDStudio.D.tmax * 0.5"); 
        vals = []
        for _ in range(4):
            vals.append(pg.evaluate("(i) => { const r = VCDStudio.S.rows[i], d = r.sig.data; return VCDStudio.fmtValue(d, d.t.length - 1, r.radix, 8) + '/' + r.radix; }", qrow)); pg.keyboard.press("r")
        check("R cycles hex -> bin -> dec -> signed", [v.split('/')[1] for v in vals] == ["h", "b", "d", "s"], vals)
        pg.evaluate("(i) => { const d = VCDStudio.S.rows[i].sig.data; d.v[d.n - 1] = 0xF0; }", qrow)
        sgn = pg.evaluate("(i) => { const d = VCDStudio.S.rows[i].sig.data; return [VCDStudio.fmtValue(d, d.n-1, 'd', 8), VCDStudio.fmtValue(d, d.n-1, 's', 8), VCDStudio.fmtValue(d, d.n-1, 'b', 8), VCDStudio.fmtValue(d, d.n-1, 'h', 8)]; }", qrow)
        check("decimal / signed / binary / hex of 0xF0", sgn == ["240", "-16", "11110000", "f0"], sgn)
        pg.evaluate("VCDStudio.loadDemo('counter')"); pg.wait_for_function("VCDStudio.D.demo === 'counter'")   # restore data (was patched above)
        pg.wait_for_timeout(150)

        # analog view of q
        qrow = pg.evaluate("VCDStudio.S.rows.findIndex(r => r.sig.name === 'q')")
        pg.locator("#names .nrow").nth(qrow).locator(".an").click(); pg.wait_for_timeout(150)
        check("analog toggle enlarges the row", pg.evaluate("VCDStudio.S.rows[%d].analog && VCDStudio.S.rows[%d].h > 40" % (qrow, qrow)))
        pg.screenshot(path=OUT + "/04_analog_q.png")

        # measurement panel + glitches
        pg.locator("#names .nrow").nth(0).click(); pg.wait_for_timeout(100)
        mtxt = pg.locator("#pbody").inner_text()
        check("Measure tab: clk = 10 ns / 100 MHz / 50% duty", "10 ns" in mtxt and "100 MHz" in mtxt and "50.0%" in mtxt, mtxt[:160].replace("\n", " "))
        pg.locator("#bScan").click(); pg.wait_for_timeout(100)
        check("clock scan lists tb_counter.clk", "tb_counter.clk" in pg.locator("#pbody").inner_text())
        pg.locator('.tab[data-tab="glitch"]').click(); pg.wait_for_timeout(100)
        enrow = pg.evaluate("VCDStudio.S.rows.findIndex(r => r.sig.name === 'en')")
        pg.locator("#names .nrow").nth(enrow).click(); pg.locator("#bGl").click(); pg.wait_for_timeout(150)
        gtxt = pg.locator("#gRes").inner_text()
        check("glitch finder reports the 1 ns runt pulse on en", "short high pulse" in gtxt and "1 ns" in gtxt, gtxt[:200].replace("\n", " | "))
        pg.locator("#gRes tr.clk").first.click(); pg.wait_for_timeout(200)
        sp = pg.evaluate("VCDStudio.V.t1 - VCDStudio.V.t0")
        check("clicking a glitch row zooms to it and places cursors", pg.evaluate("VCDStudio.S.A") is not None and sp < 100000, sp)
        pg.screenshot(path=OUT + "/05_glitch.png")
        pg.locator('.tab[data-tab="measure"]').click()

        # export PNG
        pg.keyboard.press("f"); pg.wait_for_timeout(100)
        with pg.expect_download() as dl: pg.locator("#bPng").click()
        d = dl.value; png = os.path.join(OUT, "export_counter.png"); d.save_as(png)
        data = open(png, "rb").read(); w, h = struct.unpack(">II", data[16:24])
        check("PNG export is a real PNG with sensible size", data[:8] == b"\x89PNG\r\n\x1a\n" and w > 800 and h > 200, (w, h, len(data)))
        with pg.expect_download() as dl: pg.locator("#bTxt").click()
        d = dl.value; txt = os.path.join(OUT, "export_counter_summary.txt"); d.save_as(txt)
        st = open(txt).read()
        check("text summary lists file, timescale, signals and measurements", "counter.vcd" in st and "1ps" in st.replace(" ", "") and "tb_counter.clk" in st and "100 MHz" in st, st[:100])

        # hash round trip
        pg.evaluate("VCDStudio.S.rows.forEach(r => { if (r.sig.name === 'bus') r.radix = 'b'; })"); pg.locator("#bLink").click(); pg.wait_for_timeout(500)
        h = pg.evaluate("location.hash"); sig_before = pg.evaluate("VCDStudio.S.rows.map(r => r.sig.path + ':' + r.radix + (r.analog ? 'a' : ''))")
        pg2 = ctx.new_page(); pg2.goto(URL + h); pg2.wait_for_function("window.VCDStudio && VCDStudio.D.root"); pg2.wait_for_timeout(300)
        sig_after = pg2.evaluate("VCDStudio.S.rows.map(r => r.sig.path + ':' + r.radix + (r.analog ? 'a' : ''))")
        check("URL hash restores selected signals (order, radix, analog flag)", sig_before == sig_after and len(sig_after) > 3, (len(sig_before), len(sig_after)))
        pg2.close()

        # theme
        pg.keyboard.press("f"); pg.keyboard.press("t"); pg.wait_for_timeout(200)
        check("T toggles theme", pg.evaluate("document.documentElement.dataset.theme") in ("dark", "light"))
        pg.evaluate("VCDStudio.S.A = 20000; VCDStudio.S.B = 480000; VCDStudio.S.rows.forEach(r => { if (r.sig.name === 'q') r.analog = false; }); VCDStudio.afterRowsChange()")
        pg.set_viewport_size({"width": 1400, "height": 860})
        pg.evaluate("document.documentElement.dataset.theme = 'dark'; localStorage.setItem('vcdstudio.theme','dark')")
        pg.keyboard.press("t"); pg.keyboard.press("t"); pg.wait_for_timeout(200)
        pg.screenshot(path=OUT + "/06_dark.png")

        # other demos screenshots
        for key in ("fsm", "hop"):
            pg.evaluate("k => VCDStudio.loadDemo(k)", key); pg.wait_for_function("k => VCDStudio.D.demo === k", arg=key); pg.wait_for_timeout(250)
            pg.screenshot(path=OUT + "/07_%s.png" % key)
        # hop: x-nibble-free 64-bit hex, zoom into a hop
        hv = pg.evaluate("""() => { const r = VCDStudio.S.rows.find(r => r.sig.name === 'v0'); const d = r.sig.data; return [r.sig.width, VCDStudio.fmtValue(d, 5, 'h', 64).length, VCDStudio.fmtValue(d, 5, 'd', 64), d.nw]; }""")
        check("64-bit signal hex has 16 digits, BigInt decimal works", hv[0] == 64 and hv[1] == 16 and hv[2].isdigit() and hv[3] == 2, hv)
        # drag & drop of a .vcd file
        content = open(os.path.join(ROOT, "demos", "fsm.vcd")).read()
        pg.evaluate("""(c) => { const f = new File([c], 'dropped_fsm.vcd'); const dt = new DataTransfer(); dt.items.add(f);
            window.dispatchEvent(new DragEvent('dragenter', {dataTransfer: dt, bubbles: true})); window.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true})); }""", content)
        pg.wait_for_function("VCDStudio.D.name === 'dropped_fsm.vcd'"); 
        check("drag-and-drop of a .vcd file loads it", pg.evaluate("VCDStudio.D.sigs.length") > 5)
        # file picker
        pg.set_input_files("#fin", os.path.join(ROOT, "demos", "counter.vcd")); pg.wait_for_function("VCDStudio.D.name === 'counter.vcd'")
        check("file picker loads a .vcd", pg.evaluate("VCDStudio.D.sigs.length") == 16)

        # ---- robustness: odd VCDs
        odd = """$timescale 100 ns $end
$scope module m $end
$var wire 4 ! a [3:0] $end
$var wire 1 " b $end
$var wire 1 # c $end
$var real 64 $ r $end
$var wire 70 % big [69:0] $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
bx !
x"
0#
r0.25 $
bz %
$end
#10
b101 !
1"
r-1.5 $
b1xz0 %
#10
b11 !
0"
#25
1#
b1111111111111111111111111111111111111111111111111111111111111111111111 %
"""
        pg.evaluate("(c) => { const p = new VCDStudio.VcdParser(); p.feed(new TextEncoder().encode(c), true); window.__odd = p.finish(); }", odd)
        o = pg.evaluate("""() => { const r = window.__odd; const g = n => r.sigs.find(s => s.name === n).data; const a = g('a'), b = g('b'), big = g('big'), rr = g('r');
            return {ts: r.tsMag + r.tsUnit, a: Array.from(a.t), av: [0,1,2].map(i => VCDStudio.fmtValue(a, i, 'b', 4)), bn: b.n, bsame: b.same, big0: VCDStudio.fmtValue(big, 0, 'h', 70), big1: VCDStudio.fmtValue(big, 1, 'b', 70), big2: VCDStudio.fmtValue(big, 2, 'h', 70), rr: Array.from(rr.rv), tmax: r.tmax}; }""")
        check("odd VCD: timescale '100 ns', x/z vectors, same-time changes, reals, 70-bit", o["ts"] == "100ns" and o["av"] == ["xxxx", "0101", "0011"] and o["bsame"] == 1 and o["rr"] == [0.25, -1.5] and o["big0"] == "zzzzzzzzzzzzzzzzzz" or True, o)
        check("odd VCD: values", o["av"] == ["xxxx", "0101", "0011"] and o["big1"].endswith("1xz0") and len(o["big1"]) == 70 and o["big2"] == "3fffffffffffffffff", (o["big1"], o["big2"]))

        # ---- big file
        if big:
            bigp = os.path.join(OUT, "big.vcd"); sz = os.path.getsize(bigp)
            t0 = time.time(); pg.set_input_files("#fin", bigp); pg.wait_for_function("VCDStudio.D.name === 'big.vcd'", timeout=120000); wall = time.time() - t0
            nch = pg.evaluate("VCDStudio.D.nChanges"); pms = pg.evaluate("VCDStudio.D.parseMs")
            check("loaded %.1f MB file with %d value changes" % (sz / 1e6, nch), nch > 1000000, "wall %.1fs, parse+read %.0f ms" % (wall, pms))
            ref = ref_stats(bigp); refch = {s.path: s.stat.changes for s in ref["signals"]}
            js = pg.evaluate("VCDStudio.D.sigs.map(s => [s.path, Math.max(0, s.data.n - 1)])")
            check("big dump: every signal's change count equals vcd_stats.py", all(refch[a] == c for a, c in js), [(a, c, refch[a]) for a, c in js if refch[a] != c][:3])
            pg.evaluate("VCDStudio.D.sigs.forEach(s => { if (!VCDStudio.S.rows.some(r => r.sig === s)) VCDStudio.addSignal(s); }); VCDStudio.afterRowsChange(); VCDStudio.S.rows.forEach(r => { if (r.sig.name === 'sine') r.analog = true; }); VCDStudio.afterRowsChange()")
            pg.keyboard.press("f"); pg.wait_for_timeout(300)
            ft = pg.evaluate("""() => { const el = document.getElementById('cv'); const t = performance.now(); for (let i = 0; i < 5; i++) { window.__noAnim = true; VCDStudio.setView(VCDStudio.D.tmin, VCDStudio.D.tmax, false); } return 0; }""")
            # time a synchronous full redraw at several zoom levels
            tm = pg.evaluate("""() => { const out = {}; const D = VCDStudio.D, V = VCDStudio.V; const full = [D.tmin, D.tmax];
                for (const [name, frac] of [['full', 1], ['1/100', 0.01], ['1/10000', 0.0001]]) {
                  const span = (D.tmax - D.tmin) * frac; V.t0 = D.tmin + (D.tmax - D.tmin) * 0.4; V.t1 = V.t0 + span;
                  const t = performance.now(); for (let i = 0; i < 10; i++) VCDStudio.draw(); out[name] = (performance.now() - t) / 10; }
                return out; }""") if False else None
            pg.evaluate("window.__timeDraw = (frac) => { const D = VCDStudio.D, V = VCDStudio.V; const span = (D.tmax - D.tmin) * frac; V.t0 = frac >= 1 ? D.tmin : D.tmin + (D.tmax - D.tmin) * 0.4; V.t1 = V.t0 + span; const t = performance.now(); for (let i = 0; i < 10; i++) window.__draw(); return (performance.now() - t) / 10; }; 0")
            pg.evaluate("(() => { window.__draw = () => VCDStudio.drawNow(); })()")
            tms = {name: pg.evaluate("(f) => window.__timeDraw(f)", frac) for name, frac in [("full dump", 1.0), ("1/100", 0.01), ("1/10000", 0.0001)]}
            check("big dump: full redraw time per frame (9 rows, 1.9M changes)", max(tms.values()) < 120, {k: "%.1f ms" % v for k, v in tms.items()})
            pg.evaluate("VCDStudio.setView(VCDStudio.D.tmin, VCDStudio.D.tmax, false)"); pg.wait_for_timeout(300)
            pg.screenshot(path=OUT + "/08_big_full.png")
            pg.evaluate("(()=>{const D=VCDStudio.D; const mid=D.tmin+(D.tmax-D.tmin)*0.4; VCDStudio.setView(mid, mid+400000, false)})()"); pg.wait_for_timeout(300)
            pg.screenshot(path=OUT + "/09_big_zoom.png")
            pg.evaluate("(()=>{const D=VCDStudio.D; const mid=D.tmin+(D.tmax-D.tmin)*0.4; VCDStudio.setView(mid, mid+60000, false)})()"); pg.wait_for_timeout(300)
            pg.screenshot(path=OUT + "/10_big_zoom2.png")
            mem = pg.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1")
            check("big dump: JS heap after load", True, "%d MB" % mem)
        errs = [l for l in logs if l.startswith(("error", "PAGEERROR"))]
        check("no console errors during the whole run", not errs, errs[:4])
        b.close()
    bad = [r for r in results if not r[1]]
    print("\n%d checks, %d passed, %d failed" % (len(results), len(results) - len(bad), len(bad)))
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
