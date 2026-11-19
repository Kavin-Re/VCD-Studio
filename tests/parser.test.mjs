// Unit tests for the VCD parser and value formatting (src/parser.js, src/core.js).
// No browser and no dependencies:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// The sources are plain browser scripts (no modules); evaluate them in a sandbox and pull out what we need.
// core.js only touches the DOM inside functions, so it loads fine without a document.
const ctx = vm.createContext({});
vm.runInContext(rd('src/parser.js') + '\n' + rd('src/core.js') +
  '\nglobalThis.api = {VcdParser, packBits, fmtValue, xzOf, numAt, idxAt, fmtT, D};', ctx);
const { VcdParser, fmtValue, xzOf, numAt, idxAt, fmtT, D } = ctx.api;

const bytes = (s) => new TextEncoder().encode(s);
function parse(text, chunk) {
  const u8 = typeof text === 'string' ? bytes(text) : text;
  const p = new VcdParser();
  if (!chunk) p.feed(u8, true);
  else for (let o = 0; o < u8.length; o += chunk) p.feed(u8.slice(o, o + chunk), o + chunk >= u8.length);
  return p.finish();
}
const sig = (res, p) => { const s = res.sigs.find((x) => x.path === p); assert.ok(s, 'signal ' + p + ' not found'); return s; };
const values = (s, radix = 'h') => Array.from({ length: s.data.n }, (_, i) => [s.data.t[i], fmtValue(s.data, i, radix, s.width)]);
// Plain-JS snapshot of a parse result, for whole-vs-chunked comparisons.
const snap = (res) => ({
  tmin: res.tmin, tmax: res.tmax, ts: res.tsMag + res.tsUnit, n: res.nChanges,
  sigs: res.sigs.map((s) => [s.path, s.range, s.width, s.type, s.data.n, Array.from(s.data.t), Array.from(s.data.v),
    s.data.m ? Array.from(s.data.m) : null, s.data.z ? Array.from(s.data.z) : null, s.data.rv ? Array.from(s.data.rv) : null]),
});

const HDR = `$date today $end
$version test $end
$timescale 1ns $end
$scope module top $end
$var wire 1 ! clk $end
$var reg 8 " data [7:0] $end
$var real 64 r1 volts $end
$var wire 1 # hash $end
$var wire 4 $ dollar [3:0] $end
$var wire 1 b bee $end
$scope module u0 $end
$var wire 1 ! clk $end
$var wire 1 % bit [3] $end
$scope begin blk $end
$var reg 70 w wide [69:0] $end
$upscope $end
$upscope $end
$upscope $end
$enddefinitions $end
`;

test('scopes, aliases, ranges and bit-select names', () => {
  const r = parse(HDR + '#0\n$dumpvars\n0!\nbxxxxxxxx "\n$end\n');
  assert.deepEqual(Array.from(r.sigs, (s) => s.path), ['top.clk', 'top.data', 'top.volts', 'top.hash', 'top.dollar', 'top.bee',
    'top.u0.clk', 'top.u0.bit[3]', 'top.u0.blk.wide']);
  assert.equal(sig(r, 'top.clk').data, sig(r, 'top.u0.clk').data, 'aliases of one id code share storage');
  assert.equal(sig(r, 'top.data').range, '[7:0]');
  assert.equal(sig(r, 'top.data').width, 8);
  assert.equal(r.datas.length, 8);
  assert.equal(r.root.kids[0].kids[0].kids[0].type, 'begin');
  assert.equal(r.root.kids[0].n, 9);
  assert.equal(r.meta.date, 'today');
});

test('scalar, vector, x/z, real and string value changes', () => {
  const r = parse(HDR + `#0
$dumpvars
0!
bxxxxxxxx "
r0 r1
x#
bz $
1b
$end
#5
1!
b1010 "
r-1.5e3 r1
sHello r1
1#
b1x $
b1 w
#10
0!
B1111_0000 "
Z#
#12
1"
#15
x"
`);
  assert.deepEqual(values(sig(r, 'top.clk'), 'b'), [[0, '0'], [5, '1'], [10, '0']]);
  // "b1111_0000" is not legal VCD; the parser treats unknown characters as x rather than crashing.
  const dv = values(sig(r, 'top.data'));
  assert.deepEqual(dv.slice(0, 2), [[0, 'xx'], [5, '0a']]);
  assert.deepEqual(dv.slice(3), [[12, '01'], [15, 'xx']], 'scalar change on a vector: 0/1 zero-extend, x/z fill');
  assert.deepEqual(Array.from(sig(r, 'top.volts').data.rv), [0, -1500]);
  assert.deepEqual(values(sig(r, 'top.hash'), 'b'), [[0, 'x'], [5, '1'], [10, 'z']]);
  assert.deepEqual(values(sig(r, 'top.dollar'), 'b'), [[0, 'zzzz'], [5, '001x']], 'z left-extends, 1 left-extends with 0');
  assert.deepEqual(values(sig(r, 'top.dollar'), 'h'), [[0, 'z'], [5, 'X']]);
  assert.deepEqual(values(sig(r, 'top.bee'), 'b'), [[0, '1']]);
  assert.equal(xzOf(sig(r, 'top.hash').data, 0), 1);
  assert.equal(xzOf(sig(r, 'top.hash').data, 2), 2);
  assert.equal(r.tmin, 0); assert.equal(r.tmax, 15);
});

test('id codes that look like syntax ("#", "$", "b", "r1") after a vector value', () => {
  // Regression: "b1010 $" and "b1 #" used to be read as a $command / a timestamp.
  const r = parse(HDR + '#0\nb0001 $\nb1 #\nb1 b\n#7\nb0010 $\nb0 #\nb0 b\nr2.5 r1\n#9\n');
  assert.deepEqual(values(sig(r, 'top.dollar')), [[0, '1'], [7, '2']]);
  assert.deepEqual(values(sig(r, 'top.hash'), 'b'), [[0, '1'], [7, '0']]);
  assert.deepEqual(values(sig(r, 'top.bee'), 'b'), [[0, '1'], [7, '0']]);
  assert.deepEqual(Array.from(sig(r, 'top.volts').data.rv), [2.5]);
  assert.equal(r.tmax, 9);
});

test('wide vectors: hex, binary, unsigned and signed decimal', () => {
  const r = parse(HDR + '#0\nb' + '1'.repeat(70) + ' w\n#1\nb1' + '0'.repeat(64) + ' w\n#2\nbz w\n');
  const s = sig(r, 'top.u0.blk.wide'), d = s.data;
  assert.equal(d.nw, 3);
  assert.equal(fmtValue(d, 0, 'h', 70), '3' + 'f'.repeat(17));
  assert.equal(fmtValue(d, 0, 'd', 70), (2n ** 70n - 1n).toString());
  assert.equal(fmtValue(d, 0, 's', 70), '-1');
  assert.equal(fmtValue(d, 1, 'd', 70), (2n ** 64n).toString());
  assert.equal(fmtValue(d, 1, 'b', 70), '000001' + '0'.repeat(64));
  assert.equal(fmtValue(d, 2, 'h', 70), 'z'.repeat(18));
  assert.equal(fmtValue(d, 2, 'd', 70), 'x');
  assert.ok(Number.isNaN(numAt(d, 2, false, 70)));
  assert.equal(numAt(d, 1, false, 70), 2 ** 64);
});

test('signed decimal on narrow and 32-bit vectors', () => {
  const h = '$timescale 1 ps $end $scope module t $end $var reg 8 a a [7:0] $end $var reg 32 c c [31:0] $end $upscope $end $enddefinitions $end\n';
  const r = parse(h + '#0 b11111111 a b' + '1'.repeat(32) + ' c #1 b01111111 a b1 c');
  assert.deepEqual(values(sig(r, 't.a'), 's'), [[0, '-1'], [1, '127']]);
  assert.deepEqual(values(sig(r, 't.a'), 'd'), [[0, '255'], [1, '127']]);
  assert.deepEqual(values(sig(r, 't.c'), 's'), [[0, '-1'], [1, '1']]);
  assert.deepEqual(values(sig(r, 't.c'), 'd'), [[0, '4294967295'], [1, '1']]);
});

test('timescale variants', () => {
  for (const [txt, mag, unit] of [['1ns', 1, 'ns'], ['10 ps', 10, 'ps'], ['100fs', 100, 'fs'], ['1 us', 1, 'us'], ['\n  1 s\n', 1, 's'], ['10ms', 10, 'ms']]) {
    const r = parse('$timescale ' + txt + ' $end $scope module t $end $var wire 1 ! a $end $upscope $end $enddefinitions $end #0 1!');
    assert.equal(r.tsMag, mag, txt); assert.equal(r.tsUnit, unit, txt);
  }
  const r = parse('$scope module t $end $var wire 1 ! a $end $upscope $end $enddefinitions $end #0 1!');
  assert.equal(r.tsMag + r.tsUnit, '1ns', 'default when $timescale is missing');
  Object.assign(D, { tsMag: 10, tsUnit: 'ps' });
  assert.equal(fmtT(150), '1.5 ns');
  assert.equal(fmtT(0), '0 ps');
});

test('redundant changes are dropped; same-time changes are kept and counted', () => {
  const r = parse(HDR + '#0\n0!\n#1\n0!\n#2\n1!\n0!\n#3\n0!\n');
  const d = sig(r, 'top.clk').data;
  assert.deepEqual(Array.from(d.t), [0, 2, 2]);
  assert.equal(d.same, 1);
  assert.equal(idxAt(d, 1), 0); assert.equal(idxAt(d, 2), 2); assert.equal(idxAt(d, -1), -1);
});

test('$dumpoff / $dumpon / $comment in the value section, CRLF, no trailing newline', () => {
  const r = parse((HDR + '#0\n$dumpvars\n0!\n$end\n#4\n$dumpoff\nx!\n$end\n$comment 1! is not a change $end\n#8\n$dumpon\n1!\n$end\n#9\n0!').replace(/\n/g, '\r\n'));
  assert.deepEqual(values(sig(r, 'top.clk'), 'b'), [[0, '0'], [4, 'x'], [8, '1'], [9, '0']]);
});

test('unknown id codes, values before $enddefinitions and garbage do not throw', () => {
  const r = parse('1! b101 " ' + HDR + '#0\n1?\nb1010 ??\nr1.0 nope\n1!\n#1\néé $bogus stuff $end 0!\n');
  assert.deepEqual(values(sig(r, 'top.clk'), 'b'), [[0, '1'], [1, '0']]);
  assert.equal(parse('').sigs.length, 0);
  assert.equal(parse('not a vcd file at all').sigs.length, 0);
  assert.equal(parse('$var wire 1 ! a $end').sigs.length, 1, 'var without scope lands in the root scope');
});

test('hostile names are stored verbatim (escaping is the renderer\'s job)', () => {
  const r = parse('$scope module <img/src=x/onerror=alert(1)> $end $var wire 1 ! "><script>alert(1)</script> $end $upscope $end $enddefinitions $end #0 1!');
  assert.equal(r.sigs[0].name, '"><script>alert(1)</script>');
  // core.js esc() must neutralise everything that can break out of text or a double-quoted attribute.
  const esc = vm.runInContext('esc', ctx);
  assert.equal(esc(r.sigs[0].path), '&lt;img/src=x/onerror=alert(1)&gt;.&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('chunked feeding gives the same result as one buffer, at any split', () => {
  for (const f of ['counter.vcd', 'fsm.vcd', 'hop_engine.vcd']) {
    const u8 = new Uint8Array(fs.readFileSync(path.join(ROOT, 'demos', f)));
    const whole = snap(parse(u8));
    assert.ok(whole.n > 100, f);
    for (const c of f === 'hop_engine.vcd' ? [13, 4096] : [1, 2, 3, 7, 64, 1000]) assert.deepEqual(snap(parse(u8, c)), whole, f + ' chunk=' + c);
  }
  const txt = HDR + '#0\nb0001 $\nb1 #\nb1010 "\nr2.5 r1\n#7\nb0010 $\nb0 #\nb11 "\nr-3 r1\n#9\n';
  const whole = snap(parse(txt));
  for (let c = 1; c < 40; c++) assert.deepEqual(snap(parse(txt, c)), whole, 'chunk=' + c);
});

test('chunked feeding is safe when the caller reuses its read buffer', () => {
  const txt = HDR + '#0\nb0001 $\nb10100101 "\n#7\nb0010 $\nb11110000 "\n#9\n';
  const whole = snap(parse(txt));
  const u8 = bytes(txt);
  for (let c = 1; c < 40; c++) {
    const p = new VcdParser(), buf = new Uint8Array(c);
    for (let o = 0; o < u8.length; o += c) {
      const n = Math.min(c, u8.length - o);
      buf.fill(120); buf.set(u8.subarray(o, o + n));          // stale bytes become 'x' before every read
      p.feed(buf.subarray(0, n), o + c >= u8.length);
    }
    assert.deepEqual(snap(p.finish()), whole, 'chunk=' + c);
  }
});
