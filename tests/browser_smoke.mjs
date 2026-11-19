#!/usr/bin/env node
// Dependency-free headless-Chrome smoke test for index.html (drives Chrome over the DevTools protocol).
//
//   node tests/browser_smoke.mjs                         run the checks
//   node tests/browser_smoke.mjs --screenshot docs/screenshot.png   also (re)write the README screenshots (X.png and X-dark.png)
//
// Needs Node >= 22 (built-in WebSocket) and Chrome/Chromium; set CHROME=/path/to/chrome if it is not on PATH.
// The fuller Playwright suite is tests/test_viewer.py; this one covers start-up, the three demos and,
// above all, that hostile scope / signal / file names from a VCD are never interpreted as HTML.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shotArg = process.argv.indexOf('--screenshot');
const shotPath = shotArg > 0 ? path.resolve(process.argv[shotArg + 1]) : null;

function findChrome() {
  const names = [process.env.CHROME, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'].filter(Boolean);
  for (const n of names) {
    if (path.isAbsolute(n)) { if (fs.existsSync(n)) return n; continue; }
    for (const dir of (process.env.PATH || '').split(path.delimiter)) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; }
  }
  return null;
}

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && !cond ? ' :: ' + JSON.stringify(detail) : ''));
}

const chrome = findChrome();
if (!chrome) { console.error('SKIP: no Chrome/Chromium found (set CHROME=...)'); process.exit(process.env.CI ? 1 : 0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vcdstudio-'));
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, '--window-size=1400,860', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const cleanup = () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
const timer = setTimeout(() => { console.error('FAIL: timed out'); cleanup(); process.exit(1); }, 90000);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  proc.stderr.on('data', (c) => { buf += c; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
  proc.on('exit', () => reject(new Error('Chrome exited early:\n' + buf)));
});
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else if (m.method) events.push(m);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 860, deviceScaleFactor: 1, mobile: false });
async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate('!!(' + expr + ')').catch(() => false)) return true; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('timeout waiting for ' + expr);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  await cdp('Page.navigate', { url });
  await waitFor('window.VCDStudio && VCDStudio.D.root');
  await evaluate('window.__noAnim = true');
  const errs = () => events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  check('page starts with the embedded counter demo', await evaluate('VCDStudio.D.demo') === 'counter');
  check('no console errors on start-up', errs().length === 0, errs().slice(0, 2));
  const reqs = events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url);
  check('offline: no network requests besides the page itself', reqs.every((u) => /^(file|data|blob|about):/.test(u)), reqs);

  for (const [k, minSigs] of [['counter', 10], ['fsm', 5], ['hop', 10]]) {
    await evaluate(`VCDStudio.loadDemo(${JSON.stringify(k)})`); await waitFor(`VCDStudio.D.demo === ${JSON.stringify(k)}`);
    const st = await evaluate('({n: VCDStudio.D.sigs.length, rows: VCDStudio.S.rows.length, ch: VCDStudio.D.nChanges})');
    check(`demo "${k}" parses and shows default rows`, st.n >= minSigs && st.rows >= 5 && st.ch > 100, st);
  }

  // ---- hostile input: names that try to become markup, in every place a name is rendered
  const P = ['<img src=x onerror="window.__xss=1">', '"><svg/onload=window.__xss=2>', "'onmouseover='window.__xss=3", '</span><script>window.__xss=4</script>'];
  const evil = `$date <img src=x onerror=window.__xss=5> $end
$version <b>bold</b> $end
$comment <img src=x onerror=window.__xss=6> $end
$timescale 1ns $end
$scope module ${P[0].replace(/ /g, '/')} $end
$var wire 1 ! ${P[1]} $end
$var wire 8 " ${P[2]} [7:0] $end
$var wire 1 # ${P[3].replace(/ /g, '/')} $end
$var wire 1 $ <i>x</i> <img/src=x/onerror=window.__xss=7> $end
$upscope $end
$enddefinitions $end
#0
0!
b0 "
0#
0$
${Array.from({ length: 40 }, (_, i) => `#${10 + i * 10}\n${i & 1}!\nb${(i * 7 & 255).toString(2)} "\n${i & 1}#\n${i % 3 ? 1 : 0}$${i === 20 ? '\n#211\n0!\n#212\n1!' : ''}`).join('\n')}
`;
  await evaluate(`(async () => {
    const f = new File([${JSON.stringify(evil)}], ${JSON.stringify('<img src=x onerror=window.__xss=8>.vcd')});
    await VCDStudio.loadFile(f);
    const S = VCDStudio.S, D = VCDStudio.D;
    for (const s of D.sigs) VCDStudio.addSignal(s);
    VCDStudio.afterRowsChange();
    for (const t of document.querySelectorAll('.tab')) {            // Measure, Glitches, Info panels
      t.click();
      for (let i = 0; i < S.rows.length; i++) { document.querySelectorAll('#names .nrow')[i].click(); }
      const scan = document.querySelector('#gScan, #pbody button'); if (scan) scan.click();
      document.querySelectorAll('#pbody button').forEach((b) => b.click());
    }
    const q = document.getElementById('q');                          // search-result list shows scope paths too
    q.value = 'o'; q.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 200));
    q.value = ''; q.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 200));
    document.querySelectorAll('#tree .nh').forEach((h) => { if (h.nextSibling.style.display === 'none') h.click(); });
    VCDStudio.buildSummary(); VCDStudio.drawNow();
  })()`);
  await sleep(400);
  const x = await evaluate(`({
    sigs: VCDStudio.D.sigs.length, rows: VCDStudio.S.rows.length, xss: window.__xss === undefined ? null : window.__xss,
    injected: document.querySelectorAll('#app img, #app svg, #app script, #app i, #app b, #status img, .top img, [onmouseover], [onerror], [onload]').length,
    nameText: document.querySelector('#names .nrow .nm').textContent, title: document.title,
    treeHasName: document.getElementById('tree').textContent.includes('<svg/onload='),
    infoHasDate: (() => { document.querySelector('.tab[data-tab=info]').click(); return document.getElementById('pbody').textContent.includes('<img src=x onerror=window.__xss=5>'); })(),
  })`);
  check('hostile VCD loads (4 signals, all on screen)', x.sigs === 4 && x.rows === 4, x);
  check('no script ran from scope / signal / file / $date / $comment text', x.xss === null, x);
  check('no element or event-handler attribute was injected', x.injected === 0, x);
  check('names are shown literally as text', x.nameText.includes('"><svg/onload=') && x.treeHasName && x.infoHasDate, x);
  check('no console errors after hostile file', errs().length === 0, errs().slice(0, 2).map((e) => e.params.exceptionDetails?.text || e.params.args?.[0]?.value));

  if (shotPath) {
    // counter demo, zoomed in on the 1 ns runt pulse on `en`, cursors A/B set, glitch finder open
    const hash = '#d=counter&s=tb_counter.clk;b,tb_counter.rst_n;b,tb_counter.en;b,tb_counter.up;b,tb_counter.q;h,tb_counter.wrap;b,tb_counter.bus;h&sel=2&a=382000&b=405000&v=296000~476000';
    await cdp('Page.navigate', { url: 'about:blank' });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1560, height: 820, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await cdp('Page.navigate', { url: url + hash });
    await waitFor('window.VCDStudio && VCDStudio.D.root && VCDStudio.S.rows.length >= 7');
    await evaluate(`(() => { document.querySelector('.tab[data-tab=glitch]').click(); const b = document.querySelector('#pbody button'); if (b) b.click(); })()`);
    await sleep(500);
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(data, 'base64'));
    console.log('screenshot -> ' + shotPath);
    // second picture: FSM demo, dark theme (follows prefers-color-scheme when no theme was chosen by hand)
    const dark = shotPath.replace(/(\.png)?$/i, '-dark.png');
    await cdp('Page.navigate', { url: 'about:blank' });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await cdp('Page.navigate', { url: url + '#d=fsm' });
    await waitFor('window.VCDStudio && VCDStudio.D.demo === "fsm" && VCDStudio.S.rows.length >= 5');
    await sleep(500);
    fs.writeFileSync(dark, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('screenshot -> ' + dark);
  }
} catch (e) {
  failed++; console.error('FAIL (exception): ' + (e.stack || e));
} finally {
  clearTimeout(timer); ws.close(); cleanup();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
