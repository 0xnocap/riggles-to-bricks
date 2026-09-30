// Fallbacks, robustness and phone speed on the real page (dev server). Every input path — script, port
// (?fail=generator), image (?fail=token,generator), upload after a full failure — must show a correct
// original, a solid model and its origin in "More info"; the port's picture and circles against the
// script's; Art Blocks offline or hanging; bad inputs and races; then, CPU slowed 6× on a phone viewport,
// the time from Build to the first model (Art Blocks answers replayed from memory, so the fetch is out) by
// the script path and the fallbacks (picture traced, port, upload), each display/format switch, the PDF, and
// the JS heap after 10 and 20 switches. A busy loop timed before and after proves the slowdown is on; the
// same loop in a worker shows Chrome cannot slow workers, so their jobs' own time is counted ×rate.
// Needs the dev server: npx vite --port 5180. Output: out/qa/fallbacks/ (report.json, pictures, sheet.jpg);
// a partial run (--only) replaces its own parts of report.json and keeps the others.
//   node scripts/qa-fallbacks.cjs [--only paths,mobile,offline,robust,perf,phone] [--ids 1234,3784,1004,102] [--perf-ids 1234,1004,3784,102,0,442,452] [--rate 6]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { exe } = require('./shot.cjs');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', 'http://localhost:5180/'), OUT = opt('out', 'out/qa/fallbacks');
const ALL = 'paths,mobile,offline,robust,perf,phone', ONLY = opt('only', ALL).split(',');
const IDS = opt('ids', '1234,3784,1004,102').split(',').map(Number), PERF_IDS = opt('perf-ids', '1234,1004,3784,102,0,442,452').split(',').map(Number);
const SCRATCH = opt('scratch', '/private/tmp/claude-501/-Users-jonathankarp/67713c2f-03c9-41c0-be8e-bf0a612249b5/scratchpad/stage4/qa');
const RATE = +opt('rate', 6), BUDGET = 15000;
const PHONE = { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' };
const DESKTOP = { viewport: { width: 1400, height: 900 } };
const ORIGIN_TEXT = { script: /its own script/, port: /from its hash/, image: /Traced from Art Blocks/, upload: /Traced from your picture/ };
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SCRATCH, { recursive: true });

const report = { checks: [], paths: {}, offline: {}, robust: {}, perf: {} };
let SECTION = null;   // the part running, on each check (a partial run replaces its parts in report.json)
const log = (...a) => console.log(...a);
const check = (ok, what, data) => { report.checks.push({ ok: !!ok, section: SECTION, what, ...(data ? { data } : {}) }); log(`  ${ok ? '✓' : '✗'} ${what}`); return ok; };
const s1 = ms => (ms / 1000).toFixed(1) + ' s';
const b64png = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

// ---- network: Art Blocks and cdnjs replayed from memory, or cut, or left hanging ----
const cache = new Map(), curveRef = new Map();   // Art Blocks' answers; the script path's curve of each Squiggle
const external = u => !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host);
async function net(ctx, { abort = null, hang = null, live = false } = {}) {
  await ctx.route(external, async route => {
    const url = route.request().url(), host = new URL(url).host;
    if (abort && abort.test(host)) return route.abort('internetdisconnected');
    if (hang && hang.test(host)) { await new Promise(r => setTimeout(r, 90000)); return route.abort('timedout').catch(() => {}); }
    if (!live && cache.has(url)) return route.fulfill(cache.get(url)).catch(() => {});
    try {
      const r = await route.fetch({ timeout: 30000 }), body = await r.body();
      const hit = { status: r.status(), headers: r.headers(), body };
      if (r.status() === 200) cache.set(url, hit);
      await route.fulfill(hit);
    } catch { await route.abort('failed').catch(() => {}); }
  });
}

// ---- the page ----
async function open(b, dev, o = {}) {
  const ctx = await b.newContext({ ...(dev === 'phone' ? PHONE : DESKTOP), acceptDownloads: true });
  await net(ctx, o);
  if (o.noWorker) await ctx.addInitScript(() => { delete window.Worker; });
  else await ctx.addInitScript(() => {   // each worker job's own time (trace or build), as the worker reports it, and when it came back
    const W = window.Worker, T = window.__wjobs = [];
    if (W) window.Worker = class extends W { constructor(...a) { super(...a); this.addEventListener('message', e => { if (e.data && typeof e.data.ms === 'number') T.push({ what: e.data.trace ? 'trace' : 'build', ms: Math.round(e.data.ms), at: performance.now() }); }); } };
  });
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_TIMED_OUT|accelerometer/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  let reloads = 0;   // real page loads (history.replaceState also fires framenavigated)
  p.on('load', () => reloads++);
  return { ctx, p, errs, reloads: () => reloads };
}
/** the page's state: where the Squiggle came from, the original shown, the model and its checks, "More info" */
const state = p => p.evaluate(() => {
  const s = window.stb, l = s?.loaded, m = s?.model, $ = id => document.getElementById(id), img = $('orig-img');
  return {
    origin: l?.origin ?? null, id: l?.id ?? null, hash: l?.hash ?? null, type: l?.curve.type ?? null, features: l?.features ?? null, lnotes: l?.notes ?? [],
    points: l?.curve.points.length ?? 0, stroke: l ? Math.round(l.curve.stroke) : 0,
    model: m && { format: m.format, display: m.display, scale: m.scale, pieces: m.pieces.length, floating: m.checks.floating, collisions: m.checks.collisions,
      twoStud: m.checks.twoStud, comInside: m.checks.comInside, failed: m.checks.rules.filter(r => !r.ok).map(r => r.name), notes: m.notes },
    pill: $('pill').textContent, title: $('orig-title').textContent, originText: $('orig-origin').textContent, readText: $('read-text').textContent,
    notes: [...document.querySelectorAll('#notes li')].map(li => li.textContent),
    orig: { shown: !img.hidden, w: img.naturalWidth, h: img.naturalHeight, data: img.src.startsWith('data:') },
    error: $('error').hidden ? null : $('error-text').textContent, uploadOffer: !$('error-upload').hidden, result: !$('result').hidden,
    busy: $('busy').hidden ? null : $('busy-text').textContent, examples: [...document.querySelectorAll('#examples img')].map(i => i.naturalWidth > 0),
  };
});
/** is the original a picture of a Squiggle: coloured pixels over several hues */
const pictureStats = p => p.evaluate(() => {
  const img = document.getElementById('orig-img'), c = new OffscreenCanvas(240, 160), x = c.getContext('2d');
  x.drawImage(img, 0, 0, 240, 160);
  const d = x.getImageData(0, 0, 240, 160).data, hues = new Array(12).fill(0);
  let col = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], bl = d[i + 2], mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    if (mx - mn < 60) continue;
    col++;
    const h = mx === r ? ((g - bl) / (mx - mn) + 6) % 6 : mx === g ? (bl - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
    hues[Math.floor(h * 2) % 12]++;
  }
  return { coloured: col / (240 * 160), hues: hues.filter(n => n > 240 * 160 * 0.002).length };
});
const waitModel = (p, timeout = 120000) => p.waitForFunction(() => window.stb?.model && document.getElementById('busy').hidden, null, { timeout });
/** after an action: a new Squiggle with its model, or an error */
async function waitNext(p, act, timeout = 120000) {
  await p.evaluate(() => { window.__prev = window.stb?.loaded ?? null; document.getElementById('error').hidden = true; });
  const t = Date.now();
  await act();
  await p.waitForFunction(() => { const s = window.stb; return (s?.loaded && s.loaded !== window.__prev && s.model && document.getElementById('busy').hidden) || !document.getElementById('error').hidden; }, null, { timeout });
  return Date.now() - t;
}
const solid = m => !!m && m.floating === 0 && m.collisions === 0 && !m.twoStud && m.comInside !== false && !m.failed.length;
const modelText = m => m ? `${[m.format, m.display, m.scale].filter(Boolean).join(' ')}: ${m.pieces} pieces, ${m.floating} floating, ${m.collisions} collisions${m.twoStud ? `, ${m.twoStud} loose` : ''}${m.failed.length ? `, failed ${m.failed.join(', ')}` : ''}` : 'no model';
/** every model the page offers for the Squiggle on screen (3 displays × 2 sizes, 2 Mosaics), built in its workers */
const allModels = p => p.evaluate(async () => {
  const { relief, mosaic } = await window.stb.builds.all(), out = [];
  const row = m => ({ format: m.format, display: m.display, scale: m.scale, pieces: m.pieces.length, floating: m.checks.floating, collisions: m.checks.collisions, twoStud: m.checks.twoStud,
    comInside: m.checks.comInside, failed: m.checks.rules.filter(r => !r.ok).map(r => r.name), noRole: m.pieces.filter(q => !q.role).length, plate: m.nameplate?.lines ?? null });
  for (const sc of ['large', 'small']) { for (const d of ['frame', 'floating', 'backdrop']) out.push(row(relief[sc][d])); out.push(row(mosaic[sc])); }
  return out;
});
/** all 8 models solid, and their nameplate says what is known (no number for an upload, no hash without the token) */
function checkAll(what, ms, s) {
  const bad = ms.filter(m => !solid(m) || m.noRole), want = s.id === null ? 'Chromie Squiggle' : `Chromie Squiggle #${s.id}`;
  const plates = ms.filter(m => m.plate), wrong = plates.filter(m => m.plate[0] !== want || (s.hash ? !m.plate[1].includes(s.hash.slice(2, 10)) : /0x/.test(m.plate[1])));
  check(!bad.length && ms.length === 8 && !wrong.length, `${what}: all ${ms.length} models solid (${ms.map(m => m.pieces).join(', ')} pieces)${bad.length ? ` · NOT: ${bad.map(modelText).join('; ')}` : ''} · nameplate “${plates[0]?.plate.join(' / ')}”${wrong.length ? ` · WRONG on ${wrong.length}` : ''}`);
  return ms;
}
/** "More info" says where the Squiggle came from, and the load's own notes */
function explains(s) {
  const re = ORIGIN_TEXT[s.origin];
  return !!re && re.test(s.originText) && re.test(s.readText) && s.lnotes.every(n => s.notes.includes(n));
}
async function duoShot(p, file) {
  await p.click('#skip').catch(() => {});
  await p.waitForTimeout(700);
  await p.evaluate(() => { document.getElementById('secnav').style.visibility = 'hidden'; });
  await p.locator('.duo').screenshot({ path: file });
  await p.evaluate(() => { document.getElementById('secnav').style.visibility = ''; });
}
async function moreShot(p, file) {
  await p.evaluate(() => { document.getElementById('more').open = true; document.getElementById('secnav').style.visibility = 'hidden'; });
  await p.waitForTimeout(200);
  await p.locator('#more').screenshot({ path: file });
  await p.evaluate(() => { document.getElementById('more').open = false; document.getElementById('secnav').style.visibility = ''; });
}
/** circles, curve, model fingerprint and original of the Squiggle on the page */
const fingerprint = p => p.evaluate(() => {
  const s = window.stb, l = s.loaded, m = s.model, x = new OffscreenCanvas(1, 1).getContext('2d');
  const norm = c => { if (!c) return null; x.fillStyle = '#000'; x.fillStyle = c; return x.fillStyle; };
  let h = 2166136261;
  for (const ch of m.pieces.map(q => [q.x, q.z, q.y, q.w, q.d, q.h, q.c, q.part, q.kind].join(',')).sort().join(';')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return {
    dots: l.source ? l.source.dots.map(d => [d.x, d.y, d.d, norm(d.fill), norm(d.stroke)]) : null, size: l.source ? [l.source.width, l.source.height] : null,
    points: l.curve.points.map(q => [q.x, q.y, q.hue]), canvas: l.curve.canvas, stroke: l.curve.stroke, type: l.curve.type,
    model: { pieces: m.pieces.length, hash: h.toString(16), key: `${m.format}-${m.display}-${m.scale}` }, original: l.original,
  };
});
/** pixel difference of two pictures (same size after scaling b to a), with a picture of where they differ */
const pixelDiff = (p, a, b) => p.evaluate(async ([a, b]) => {
  const load = src => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('image')); i.src = src; });
  const [A, B] = await Promise.all([load(a), load(b)]), w = A.naturalWidth, h = A.naturalHeight;
  const px = I => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.drawImage(I, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const da = px(A), db = px(B), out = new ImageData(w, h);
  let n16 = 0, n64 = 0, shift = 0, ink = 0, sum = 0, max = 0;
    for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 64) {   // structural: out of the other picture's range within 1 px (so not an edge drawn a little softer or 1 px off)
      const x = (i >> 2) % w, y = (i >> 2) / w | 0, out = (p, q) => {
        for (let c = 0; c < 3; c++) {
          let lo = 255, hi = 0;
          for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) { const k = q[(v * w + u) * 4 + c]; lo = Math.min(lo, k); hi = Math.max(hi, k); }
          if (p[i + c] < lo - 32 || p[i + c] > hi + 32) return true;
        }
        return false;
      };
      if (out(da, db) || out(db, da)) shift++;
    }
    const inked = Math.min(da[i], da[i + 1], da[i + 2]) < 240 || Math.min(db[i], db[i + 1], db[i + 2]) < 240;
    if (inked) ink++;
    sum += d; max = Math.max(max, d); if (d > 16) n16++; if (d > 64) n64++;
    const g = 255 - (255 - (da[i] + da[i + 1] + da[i + 2]) / 3) * 0.3;
    out.data.set(d > 64 ? [230, 0, 0, 255] : d > 16 ? [255, 160, 0, 255] : [g, g, g, 255], i);
  }
  const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(out, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const png = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  return { size: `${w}×${h}`, other: `${B.naturalWidth}×${B.naturalHeight}`, ink, n16, n64, shift, mean: +(sum / (w * h)).toFixed(3), max, png };
}, [a, b]);
/** circles of two runs: same count, positions, sizes, colours */
function compareDots(a, b) {
  if (!a || !b) return { same: false, why: 'no circles' };
  let dx = 0, dd = 0, fill = 0, stroke = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dx = Math.max(dx, Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1])); dd = Math.max(dd, Math.abs(a[i][2] - b[i][2]));
    if (a[i][3] !== b[i][3]) fill++;
    if (a[i][4] !== b[i][4]) stroke++;
  }
  return { same: a.length === b.length && dx <= 0.5 && dd <= 0.5 && !fill && !stroke, count: [a.length, b.length], maxPos: +dx.toFixed(4), maxSize: +dd.toFixed(4), fillDiff: fill, strokeDiff: stroke };
}
/** how far a traced line is from the true one (canvas px and strokes), and its hue error */
function compareCurves(truth, traced, stroke) {
  const d = [], dh = [];
  for (const [x, y, h] of traced) {
    let best = Infinity, bh = 0;
    for (const [X, Y, H] of truth) { const e = (X - x) ** 2 + (Y - y) ** 2; if (e < best) { best = e; bh = H; } }
    d.push(Math.sqrt(best)); const g = Math.abs(h - bh) % 360; dh.push(Math.min(g, 360 - g));
  }
  const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  let cover = 0;   // how much of the true line the traced one reaches (within a stroke)
  for (const [X, Y] of truth) if (traced.some(([x, y]) => (X - x) ** 2 + (Y - y) ** 2 < stroke * stroke)) cover++;
  return { meanPx: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1), p95Px: +q(d, 0.95).toFixed(1), maxPx: +Math.max(...d).toFixed(1),
    meanStrokes: +(d.reduce((a, b) => a + b, 0) / d.length / stroke).toFixed(2), hueMedian: +q(dh, 0.5).toFixed(1), coverage: +(cover / truth.length).toFixed(3) };
}
const retry = async (what, fn) => {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i < 1 && /context was destroyed|navigat|Target closed|detached|has been closed/i.test(e.message)) { log(`  (page reloaded during ${what}: again)`); continue; }
      throw e;
    }
  }
};

const within = (ms, what, pr) => Promise.race([pr, new Promise((_, ko) => setTimeout(() => ko(new Error(`${what}: no answer after ${s1(ms)}`)), ms))]);
const REPORT = path.join(OUT, 'report.json');
/** a partial run (--only) keeps the other parts of the last report: their data and checks */
const save = () => {
  let old = {};
  if (ONLY.join(',') !== ALL) try { old = JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch { /* first run */ }
  const keep = (old.checks ?? []).filter(c => c.section && !ONLY.includes(c.section)), order = ALL.split(',');
  const checks = [...keep, ...report.checks].sort((a, c) => order.indexOf(a.section) - order.indexOf(c.section));
  const runs = { ...old.runs }; for (const k of ONLY) runs[k] = new Date().toLocaleString('sv').slice(0, 16);
  const fresh = Object.fromEntries(ONLY.map(k => [k, report[k]]));
  fs.writeFileSync(REPORT, JSON.stringify({ ...old, ...fresh, checks, runs, summary: { ...report.summary, checks: checks.length, failed: checks.filter(c => !c.ok).length } }, null, 1));
};

// ---- test pictures: Art Blocks' PNGs of #1234 and #3784 (Pipe), and made from #1234 a phone screenshot and a small grey one ----
async function abImage(id) {   // the media URL of the brief (media-proxy.artblocks.io) redirects here
  const png = path.join(SCRATCH, `artblocks-${id}.png`);
  if (!fs.existsSync(png)) {
    const r = await fetch(`https://artblocks-mainnet.s3.amazonaws.com/${id}.png`, { signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/png') || buf.length > 1e6) throw new Error(`Art Blocks image: ${r.status} ${r.headers.get('content-type')} ${buf.length} bytes`);
    fs.writeFileSync(png, buf);
  }
  return png;
}
async function pictures(p) {
  const png = await abImage(1234), pipe = await abImage(3784);
  const src = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64');
  const made = await p.evaluate(async src => {
    const i = new Image(); i.src = src; await i.decode();
    const out = {};
    const jpeg = async (c, q) => { const b = await c.convertToBlob({ type: 'image/jpeg', quality: q }); return new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
    { // a phone screenshot: status bar, the picture 1100 px wide on grey, a caption and buttons under it
      const c = new OffscreenCanvas(1179, 2556), x = c.getContext('2d');
      x.fillStyle = '#d4d4d8'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#111'; x.font = '600 44px sans-serif'; x.fillText('9:41', 80, 90); x.fillRect(1010, 62, 90, 36);
      x.fillStyle = '#333'; x.font = '500 40px sans-serif'; x.fillText('‹ Back', 50, 230); x.fillText('Chromie Squiggle', 420, 230);
      const w = 1100, h = w * i.naturalHeight / i.naturalWidth, y = 420;
      x.drawImage(i, 40, y, w, h);
      x.fillStyle = '#111'; x.font = '700 64px sans-serif'; x.fillText('Chromie Squiggle #1234', 50, y + h + 130);
      x.fillStyle = '#555'; x.font = '400 44px sans-serif'; x.fillText('Snowfro · Art Blocks Curated', 50, y + h + 210);
      x.fillStyle = '#2563eb'; x.fillRect(50, y + h + 300, 1079, 140); x.fillStyle = '#fff'; x.font = '600 52px sans-serif'; x.fillText('View details', 440, y + h + 390);
      out.phone = await jpeg(c, 0.8);
    }
    { // the picture drawn small (640 px) in the middle of a grey square
      const c = new OffscreenCanvas(1400, 1400), x = c.getContext('2d');
      x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(i, 380, 487, 640, 640 * i.naturalHeight / i.naturalWidth);
      out.grey = await jpeg(c, 0.85);
    }
    { // the picture only, as a JPEG of a phone's size (crop of a screenshot)
      const c = new OffscreenCanvas(1170, 780), x = c.getContext('2d');
      x.drawImage(i, 0, 0, 1170, 780);
      out.cropped = await jpeg(c, 0.75);
    }
    return out;
  }, src);
  const files = { png, pipe, phone: path.join(SCRATCH, 'phone-screenshot-1234.jpg'), grey: path.join(SCRATCH, 'grey-small-1234.jpg'), cropped: path.join(SCRATCH, 'phone-crop-1234.jpg') };
  b64png(files.phone, made.phone); b64png(files.grey, made.grey); b64png(files.cropped, made.cropped);
  return files;
}

// ---- 1. the four paths ----
async function paths(b) {
  log('\n===== 1. input paths (desktop, live Art Blocks, answers kept for the rest) =====');
  const { ctx, p, errs } = await open(b, 'desktop');
  const R = report.paths;
  for (const id of IDS) {
    const row = R[id] = {};
    // script, then port: the same circles, picture and model
    let ref = null;
    for (const [q, want] of [['', 'script'], ['generator', 'port'], ['token', 'script'], ['token,generator', 'image']]) {
      await retry(`#${id} ${want}`, async () => {
        const t = Date.now();
        await p.goto(`${BASE}?${q ? `fail=${q}&` : ''}id=${id}`);
        await waitModel(p);
        const s = await state(p), pic = await pictureStats(p), fp = await fingerprint(p), ms = Date.now() - t;
        const key = `${want}${q === 'token' ? '-no-token' : ''}`;
        row[key] = { ms, origin: s.origin, type: s.type, features: s.features, points: s.points, stroke: s.stroke, model: s.model, notes: s.notes, originText: s.originText, picture: pic, orig: s.orig, title: s.title };
        check(s.origin === want && solid(s.model) && s.orig.shown && s.orig.w > 0 && pic.coloured > 0.01 && pic.hues >= 3 && explains(s),
          `#${id} ?fail=${q || '(none)'} → ${s.origin} (${s.type}, ${s.points} points) in ${s1(ms)} · original ${s.orig.w}×${s.orig.h}, ${(pic.coloured * 100).toFixed(1)}% coloured, ${pic.hues} hues · ${modelText(s.model)} · More info: “${s.originText}”`);
        if (want === 'script' && !q) { ref = fp; curveRef.set(id, fp); b64png(path.join(OUT, `original-${id}-script.png`), fp.original); }
        if (want === 'port') {
          const dots = compareDots(ref.dots, fp.dots), diff = await pixelDiff(p, ref.original, fp.original);
          b64png(path.join(OUT, `original-${id}-port.png`), fp.original); b64png(path.join(OUT, `diff-${id}-script-vs-port.png`), diff.png);
          delete diff.png;
          row.portVsScript = { dots, pixels: diff, model: { script: ref.model, port: fp.model } };
          check(dots.same, `#${id} port vs script circles: ${dots.count.join(' vs ')}, max position Δ ${dots.maxPos} px, size Δ ${dots.maxSize} px, fill mismatches ${dots.fillDiff}, stroke mismatches ${dots.strokeDiff}`);
          row.portOriginal = fp.original;   // judged against Art Blocks' own picture below (the image path)
          log(`    port vs script picture ${diff.size}: ${diff.shift} px differ structurally (${(100 * diff.shift / diff.ink).toFixed(3)}% of the ${diff.ink} inked: out of the other's range within 1 px); raw: ${diff.n64} by > 64 (${(100 * diff.n64 / diff.ink).toFixed(2)}%), ${diff.n16} by > 16, mean Δ ${diff.mean}`);
          check(fp.model.hash === ref.model.hash, `#${id} port vs script Large Frame: ${fp.model.pieces} vs ${ref.model.pieces} pieces, ${fp.model.hash === ref.model.hash ? 'identical pieces' : 'DIFFERENT pieces'}`);
          row.portAll = checkAll(`#${id} port`, await allModels(p), s);
          await duoShot(p, path.join(OUT, `path-${id}-port.png`));
          if (id === IDS[0]) await moreShot(p, path.join(OUT, `more-info-${id}-port.png`));
        }
        if (want === 'image') {
          const c = compareCurves(ref.points, fp.points, ref.stroke), diff = await pixelDiff(p, ref.original, fp.original);
          b64png(path.join(OUT, `diff-${id}-script-vs-artblocks-image.png`), diff.png); delete diff.png;
          row.imageVsScript = { curve: c, pixels: diff, type: [ref.type, fp.type], model: { script: ref.model, image: fp.model } };
          row.imageAll = checkAll(`#${id} image`, await allModels(p), s);
          check(fp.type === ref.type, `#${id} image path reads the type: ${fp.type} (script: ${ref.type}), stroke ${Math.round(fp.stroke)} px (script ${Math.round(ref.stroke)})`);
          check(c.meanStrokes < 0.35 && c.coverage > 0.95, `#${id} traced line vs the script's: mean ${c.meanPx} px (${c.meanStrokes} stroke), p95 ${c.p95Px} px, max ${c.maxPx} px, covers ${(c.coverage * 100).toFixed(1)}% of it, hue error median ${c.hueMedian}°`);
          log(`    Art Blocks' picture vs the script's redraw: ${diff.shift} px differ structurally, ${diff.n64} by > 64 (${(100 * diff.n64 / diff.ink).toFixed(2)}% of inked); models: script ${ref.model.pieces} pieces, image ${fp.model.pieces}`);
          if (row.portOriginal) {   // the port's picture: as close to Art Blocks' own as the script's redraw, or closer
            const pv = row.portVsScript.pixels, ap = await pixelDiff(p, fp.original, row.portOriginal); delete ap.png;
            row.portVsScript.artblocks = { script: { mean: diff.mean, n64: diff.n64, shift: diff.shift }, port: { mean: ap.mean, n64: ap.n64, shift: ap.shift } };
            delete row.portOriginal;
            check(pv.shift <= pv.ink * 0.002 || ap.mean <= diff.mean * 1.1, `#${id} port picture: ${(100 * pv.shift / pv.ink).toFixed(3)}% of inked pixels differ structurally from the script's redraw; against Art Blocks' own picture the port is off by mean Δ ${ap.mean} (${ap.n64} px > 64), the script's redraw by ${diff.mean} (${diff.n64} px > 64)`);
          }
          await duoShot(p, path.join(OUT, `path-${id}-image.png`));
          if (id === IDS[0]) await moreShot(p, path.join(OUT, `more-info-${id}-image.png`));
        }
      });
    }
  }
  // full failure → message with an upload offer → Art Blocks' PNG, then a phone screenshot and others
  const files = await pictures(p), abPng = id => 'data:image/png;base64,' + fs.readFileSync(path.join(SCRATCH, `artblocks-${id}.png`)).toString('base64');
  await p.goto(`${BASE}?fail=token,generator,image&id=1234`);
  await p.waitForSelector('#error:not([hidden])', { timeout: 60000 });
  let s = await state(p);
  check(/upload/i.test(s.error) && s.uploadOffer && !s.result, `?fail=token,generator,image: “${s.error}” · Upload button ${s.uploadOffer ? 'shown' : 'MISSING'} · result ${s.result ? 'shown' : 'hidden'}`);
  await p.locator('#input-panel').screenshot({ path: path.join(OUT, 'full-failure.png') });
  for (const [name, file, input, id] of [['Art Blocks PNG (via the error’s Upload button)', files.png, '#file2', 1234], ['phone screenshot JPEG', files.phone, '#file', 1234],
    ['small on grey JPEG', files.grey, '#file', 1234], ['phone crop JPEG', files.cropped, '#file', 1234], ['Art Blocks PNG of #3784 (Pipe)', files.pipe, '#file', 3784]]) {
    const ms = await waitNext(p, () => p.setInputFiles(input, file));
    s = await state(p);
    const pic = s.model ? await pictureStats(p) : null, key = path.basename(file).replace(/\.\w+$/, '');
    R[`upload-${key}`] = { ms, ...s, picture: pic };
    if (s.error) { check(false, `upload ${name}: error “${s.error}” after ${s1(ms)}`); continue; }
    const fp = await fingerprint(p), truth = curveRef.get(id), c = truth ? compareCurves(truth.points, fp.points, truth.stroke) : null;
    const od = await pixelDiff(p, fp.original, abPng(id)); delete od.png;   // the original shown: the Squiggle's picture, cut out of the screenshot
    R[`upload-${key}`].curve = c; R[`upload-${key}`].originalVsArtBlocks = od;
    check(s.origin === 'upload' && s.id === null && solid(s.model) && explains(s) && s.orig.shown && (!truth || s.type === truth.type),
      `upload ${name}: origin ${s.origin} in ${s1(ms)}, “${s.title}”, ${s.type} (${s.points} points, stroke ${s.stroke} px) · ${modelText(s.model)} · “${s.originText}”`);
    check(Math.abs(s.orig.w / s.orig.h - 1.5) < 0.03 && od.mean < 12, `upload ${name}: original shown ${s.orig.w}×${s.orig.h}, against Art Blocks' picture mean Δ ${od.mean}, ${(100 * od.n64 / od.ink).toFixed(2)}% of inked px off by > 64`);
    R[`upload-${key}`].all = checkAll(`upload ${name}`, await allModels(p), s);
    if (c) check(c.meanStrokes < 0.35 && c.coverage > 0.95, `upload ${name}: traced line vs the script's: mean ${c.meanPx} px (${c.meanStrokes} stroke), max ${c.maxPx} px, covers ${(c.coverage * 100).toFixed(1)}%, hue error median ${c.hueMedian}°`);
    await duoShot(p, path.join(OUT, `upload-${key}.png`));
  }
  await moreShot(p, path.join(OUT, 'more-info-upload.png'));
  check(!errs.length, `paths: page errors ${errs.length ? errs.join(' | ') : 'none'}`);
  await ctx.close();
}

// ---- 1 bis. on a phone: the port, then the full failure's message and upload, at 393 px ----
async function mobile(b) {
  log('\n===== 1 bis. fallbacks on a phone (393×851) =====');
  const { ctx, p, errs } = await open(b, 'phone'), R = report.mobile = {};
  const files = await pictures(p);
  const wide = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await p.goto(`${BASE}?fail=generator&id=3784`); await waitModel(p);
  let s = await state(p);
  R.port = { origin: s.origin, model: s.model, overflow: await wide() };
  check(s.origin === 'port' && solid(s.model) && explains(s) && !R.port.overflow, `phone ?fail=generator #3784 → ${s.origin}, ${modelText(s.model)} · “${s.originText}” · horizontal overflow ${R.port.overflow} px`);
  await p.goto(`${BASE}?fail=token,generator,image&id=1234`);
  await p.waitForSelector('#error:not([hidden])', { timeout: 60000 });
  s = await state(p);
  const btn = await p.locator('#error-upload').boundingBox(), vw = PHONE.viewport.width;
  R.failure = { error: s.error, uploadOffer: s.uploadOffer, button: btn, overflow: await wide() };
  check(s.uploadOffer && btn && btn.x >= 0 && btn.x + btn.width <= vw && btn.height >= 40 && !R.failure.overflow,
    `phone full failure: “${s.error}” · Upload button ${btn ? `${Math.round(btn.width)}×${Math.round(btn.height)} px at x ${Math.round(btn.x)}` : 'MISSING'} · horizontal overflow ${R.failure.overflow} px`);
  await p.locator('#error').scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(OUT, 'mobile-full-failure.png') });
  const ms = await waitNext(p, () => p.setInputFiles('#file2', files.phone));
  s = await state(p);
  R.upload = { ms, origin: s.origin, type: s.type, model: s.model, overflow: await wide() };
  check(s.origin === 'upload' && s.type === 'Normal' && solid(s.model) && explains(s) && !R.upload.overflow,
    `phone upload of the phone screenshot: ${s.origin} ${s.type} in ${s1(ms)}, ${modelText(s.model)} · horizontal overflow ${R.upload.overflow} px`);
  await p.click('#skip').catch(() => {}); await p.waitForTimeout(700);
  await p.evaluate(() => { document.getElementById('secnav').style.visibility = 'hidden'; });
  await p.locator('#sec-model').screenshot({ path: path.join(OUT, 'mobile-upload.png') });
  check(!errs.length, `phone fallbacks: page errors ${errs.length ? errs.join(' | ') : 'none'}`);
  await ctx.close();
}

// ---- 2. Art Blocks offline, broken or hanging ----
async function offline(b) {
  log('\n===== 2. offline and broken networks (desktop) =====');
  const R = report.offline;
  const files = { png: path.join(SCRATCH, 'artblocks-1234.png') };
  const AB = /(^|\.)artblocks\.io$/, S3 = /amazonaws\.com$/, CDN = /cdnjs\.cloudflare\.com/, or = (...r) => new RegExp(r.map(x => x.source).join('|'));
  for (const [name, o, expect, upDuring] of [
    ['*.artblocks.io and cdnjs cut', { abort: or(AB, CDN) }, 'image or error'],
    ['*.artblocks.io, its S3 bucket and cdnjs cut', { abort: or(AB, S3, CDN) }, 'error'],
    ['everything outside the site cut', { abort: /.*/ }, 'error'],
    ['cdnjs only cut (p5 missing)', { abort: CDN }, 'port'],
    ['token and generator hosts cut', { abort: /^(token|generator)\.artblocks\.io$/ }, 'image'],
    ['Art Blocks, S3 and cdnjs hanging', { hang: or(AB, S3, CDN) }, 'error'],
    ['Art Blocks hanging, picture uploaded while waiting', { hang: or(AB, S3, CDN) }, 'upload', true],
  ]) {
    const { ctx, p, errs } = await open(b, 'desktop', { ...o, live: true });
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });   // hanging thumbnails hold the load event
    await p.waitForFunction(() => [...document.querySelectorAll('#examples img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 6000 }).catch(() => {});
    const examples = (await state(p)).examples;
    await p.evaluate(() => { new MutationObserver(() => { (window.__busy ??= []).push([Math.round(performance.now() - window.__t0), document.getElementById('busy').hidden ? '(hidden)' : document.getElementById('busy-text').textContent]); }).observe(document.getElementById('busy'), { attributes: true, childList: true, characterData: true, subtree: true }); });
    const t0 = Date.now();
    await p.fill('#sq-number', '1234');
    await p.evaluate(() => { window.__t0 = performance.now(); });
    await p.click('.go');
    let uploaded = null;
    if (upDuring) {   // the "upload an image of it" offer while Art Blocks keeps us waiting
      await p.waitForSelector('#busy-text label[for="file"]', { timeout: 30000 });
      const offer = Date.now() - t0;
      await p.screenshot({ path: path.join(OUT, 'offline-slow-offer.png') });
      await p.setInputFiles('#file', files.png);
      await waitModel(p, 60000);
      uploaded = { offer, model: Date.now() - t0 };
      await p.waitForTimeout(Math.max(0, 32000 - (Date.now() - t0)));   // past the hung load's own end (≈ 20 s)
    }
    await p.waitForFunction(() => (window.stb?.model && document.getElementById('busy').hidden) || !document.getElementById('error').hidden, null, { timeout: 150000 });
    const ms = Date.now() - t0, s = await state(p);
    const busy = await p.evaluate(() => window.__busy ?? []), texts = [...new Set(busy.map(([, x]) => x).filter(x => x !== '(hidden)'))];
    const slow = busy.find(([, x]) => /slow to answer/.test(x))?.[0] ?? null;
    R[name] = { ms, origin: s.origin, error: s.error, uploadOffer: s.uploadOffer, model: s.model, examplesShown: examples.filter(Boolean).length, slowOfferMs: slow, uploaded, busy };
    const got = s.error ? 'error' : s.origin;
    check(expect.includes(got) && (got !== 'error' || (s.uploadOffer && /upload/i.test(s.error))) && (got === 'error' || solid(s.model)),
      `${name}: ${got === 'error' ? `“${s.error}” (Upload button ${s.uploadOffer ? 'shown' : 'MISSING'})` : `origin ${s.origin}, ${modelText(s.model)}`} after ${s1(ms)}${slow !== null ? ` · “slow… or upload” offer at ${s1(slow)}` : ''} · example thumbnails shown ${examples.filter(Boolean).length}/5 · steps: ${texts.join(' → ')}`);
    if (upDuring) check(uploaded && s.origin === 'upload' && !s.error && solid(s.model), `${name}: offer at ${s1(uploaded.offer)}, the upload's model at ${s1(uploaded.model)}, still shown at ${s1(ms)} after the hung load gave up (error ${s.error ? `“${s.error}” SHOWN over it` : 'not shown'})`);
    if (o.abort && !examples.every(Boolean)) check(false, `${name}: example thumbnails ${examples.filter(Boolean).length}/5 (they should be drawn from their hash when Art Blocks can't be reached)`);
    if (got === 'error') {
      await p.locator('#input-panel').screenshot({ path: path.join(OUT, `offline-${name.replace(/\W+/g, '-')}.png`) });
      if (fs.existsSync(files.png)) {
        const up = await waitNext(p, () => p.setInputFiles('#file2', files.png));
        const u = await state(p);
        R[name].upload = { ms: up, origin: u.origin, model: u.model };
        check(u.origin === 'upload' && solid(u.model), `${name}: the upload then works offline: ${modelText(u.model)} in ${s1(up)}`);
      }
    }
    if (!upDuring && ms > 30000) check(false, `${name}: ${s1(ms)} before the visitor hears anything definite (fetch timeouts add up)`);
    if (o.hang && !upDuring) check(slow !== null && slow <= 12000 && ms <= 25000, `${name}: the “slow… or upload” offer ${slow === null ? 'NEVER shown' : `at ${s1(slow)}`}, the final message at ${s1(ms)} (brief: upload offered within about 20 s)`);
    const own = errs.filter(e => !/p5 is not defined/.test(e));   // the sandboxed script's own error, caught and reported by source.ts
    check(!own.length, `${name}: page errors ${own.length ? own.join(' | ') : 'none'}${own.length < errs.length ? ` (plus “p5 is not defined” inside the sandboxed frame, expected)` : ''}`);
    await ctx.close();
  }
}

// ---- 3. bad inputs and races ----
async function robust(b) {
  log('\n===== 3. bad inputs and races (desktop) =====');
  const R = report.robust;
  const { ctx, p, errs } = await open(b, 'desktop');
  // typed or pasted numbers (the field keeps 4 characters): a clear message, or the Squiggle meant
  for (const [v, want] of [['10000', null], ['abc', null], ['', null], ['-5', null], ['12.5', null], ['#7583', 7583], [' 42 ', 42], ['0042', 42]]) {
    await p.goto(BASE);
    await p.locator('#sq-number').pressSequentially(v); await p.click('.go'); await p.waitForTimeout(600);
    const typed = await p.inputValue('#sq-number');
    await p.waitForFunction(() => !document.getElementById('error').hidden || window.stb?.loaded, null, { timeout: 60000 }).catch(() => {});
    const s = await state(p);
    R[`number "${v}"`] = { typed, error: s.error, id: s.id };
    check(want === null ? !!s.error && /0 to 9999/.test(s.error) && !s.result : s.id === want,
      `number “${v}” typed (field shows “${typed}”): ${s.error ? `“${s.error}”` : `builds #${s.id}`}${want !== null ? ` (meant #${want})` : ''}`);
  }
  { // pasted, as from Art Blocks or a tweet
    await p.goto(BASE);
    await p.focus('#sq-number');
    await p.evaluate(() => { const i = document.getElementById('sq-number'), dt = new DataTransfer(); dt.setData('text/plain', '#7583'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await p.keyboard.insertText('#7583');
    const typed = await p.inputValue('#sq-number');
    await p.click('.go');
    await p.waitForFunction(() => !document.getElementById('error').hidden || window.stb?.loaded, null, { timeout: 60000 }).catch(() => {});
    const s = await state(p);
    R['number pasted "#7583"'] = { typed, error: s.error, id: s.id };
    check(s.id === 7583, `“#7583” pasted (field shows “${typed}”): ${s.error ? `“${s.error}”` : `builds #${s.id}`} (meant #7583)`);
  }
  await p.goto(BASE);
  // pictures that are not Squiggles
  const junk = await p.evaluate(async () => {
    const enc = async (c, type = 'image/png') => { const b = await c.convertToBlob({ type }); return new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
    const out = {};
    { const c = new OffscreenCanvas(1200, 800), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 800); out.blank = await enc(c); }
    { const c = new OffscreenCanvas(900, 600), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 900, 600);
      g.addColorStop(0, '#f80'); g.addColorStop(0.5, '#08f'); g.addColorStop(1, '#8f0'); x.fillStyle = g; x.fillRect(0, 0, 900, 600);
      for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 37 % 360} 70% 50%)`; x.fillRect((i * 97) % 900, (i * 53) % 600, 30, 30); }
      out.photo = await enc(c, 'image/jpeg'); }
    { const c = new OffscreenCanvas(40, 30), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 40, 30); x.fillStyle = '#e33'; x.fillRect(5, 12, 30, 5); out.tiny = await enc(c); }
    return out;
  });
  const jf = {};
  for (const [k, v] of Object.entries(junk)) { jf[k] = path.join(SCRATCH, `junk-${k}.${v.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`); b64png(jf[k], v); }
  jf.text = path.join(SCRATCH, 'not-an-image.png'); fs.writeFileSync(jf.text, 'this is not a picture');
  for (const [name, file] of [['blank white PNG', jf.blank], ['colourful non-Squiggle JPEG', jf.photo], ['40×30 PNG', jf.tiny], ['text file named .png', jf.text]]) {
    const ms = await waitNext(p, () => p.setInputFiles('#file', file), 60000).catch(e => { throw new Error(`${name}: ${e.message}`); });
    const s = await state(p);
    R[`upload ${name}`] = { ms, error: s.error, origin: s.origin, model: s.model };
    check(!!s.error, `upload ${name}: ${s.error ? `“${s.error}”` : `ACCEPTED as a Squiggle (${s.type}, ${modelText(s.model)})`} after ${s1(ms)}`);
    if (!s.error) await duoShot(p, path.join(OUT, `junk-${name.replace(/\W+/g, '-')}.png`));
  }
  // races: a second number while the first loads; quick switches
  await p.goto(BASE);
  await p.fill('#sq-number', '1234'); await p.click('.go');
  await p.waitForTimeout(250);
  await p.fill('#sq-number', '102'); await p.click('.go');
  await waitModel(p);
  await p.waitForTimeout(3000);
  let s = await state(p);
  R.race = { title: s.title, id: s.id, model: s.model };
  check(s.id === 102 && s.title === 'Chromie Squiggle #102' && s.type === 'Bold' && /#102/.test(await p.textContent('#model-sub')), `race 1234 then 102: shows ${s.title} (${s.type}) · ${await p.textContent('#model-sub')}`);
  await p.click('.disp[data-display="floating"]'); await p.click('.disp[data-display="backdrop"]'); await p.click('[data-format="mosaic"]'); await p.click('[data-scale="small"]');
  await p.waitForFunction(() => { const m = window.stb.model; return m.format === 'mosaic' && m.scale === 'small' && document.getElementById('busy').hidden; }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  s = await state(p);
  const picked = await p.evaluate(() => ({ format: document.querySelector('[data-format][aria-checked="true"]')?.dataset.format, scale: document.querySelector('[data-scale][aria-checked="true"]')?.dataset.scale, sub: document.getElementById('model-sub').textContent }));
  check(s.model.format === 'mosaic' && s.model.scale === 'small' && picked.format === 'mosaic' && picked.scale === 'small', `4 quick clicks (Floating, Backdrop, Mosaic, 64×32): ends on ${modelText(s.model)} · picker ${picked.format} ${picked.scale} · “${picked.sub}”`);
  check(!errs.length, `robustness: page errors ${errs.length ? errs.join(' | ') : 'none'}`);
  await ctx.close();
}

// ---- 4. phone speed ----
/** the fallbacks timed on the slowed phone too: Art Blocks' picture traced (Fuzzy: the most points), the port, an upload */
const PERF_FALLBACKS = [['image', 1004, '?fail=token,generator'], ['image', 102, '?fail=token,generator'], ['port', 3784, '?fail=generator'], ['upload', 1234, '']];
async function warm(b) {   // Art Blocks' answers for the ids and the pictures, once, unthrottled
  for (const [q, id] of [...PERF_IDS.map(id => ['', id]), ...PERF_FALLBACKS.filter(f => f[0] === 'image').map(([, id, q]) => [q, id])]) {
    if (!q && [...cache.keys()].some(u => u.endsWith(`/${id}`))) continue;
    if (q && [...cache.keys()].some(u => u.endsWith(`/${id}.png`))) continue;
    const { ctx, p } = await open(b, 'desktop');
    await p.goto(`${BASE}${q ? `${q}&` : '?'}id=${id}`); await waitModel(p);
    await ctx.close();
  }
}
/** a phone page, CPU slowed, the Build click (or the picture chosen) timed: loaded, original shown, first model on screen, animation over */
async function phonePage(b, noWorker, query = '') {
  const o = await open(b, 'phone', { noWorker });
  const { ctx, p } = o;
  await p.goto(BASE + query);
  await p.waitForTimeout(2500);        // three.js loads when the page is idle
  await p.evaluate(async noWorker => { await import('/src/squiggle/stage.ts'); if (noWorker) await import('/src/squiggle/worker.ts'); }, noWorker);
  const cdp = await ctx.newCDPSession(p), before = await calib(p), wBefore = noWorker ? null : await calibWorker(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  const after = await calib(p), wAfter = noWorker ? null : await calibWorker(p);
  await p.evaluate(() => {
    const P = window.__perf = { t0: 0, busy: [], progress: [] }, $ = id => document.getElementById(id), go = () => { P.t0 ||= performance.now(); };
    $('by-number').addEventListener('submit', go, { capture: true, once: true });
    for (const id of ['file', 'file2']) $(id).addEventListener('change', go, { capture: true, once: true });
    new MutationObserver(() => { if (P.t0) P.busy.push([Math.round(performance.now() - P.t0), $('busy').hidden ? '(done)' : $('busy-text').textContent]); }).observe($('busy'), { attributes: true, childList: true, subtree: true, characterData: true });
    new MutationObserver(() => P.progress.push([Math.round(performance.now()), $('progress').hidden ? '(hidden)' : $('progress-text').textContent])).observe($('progress'), { attributes: true, childList: true, subtree: true, characterData: true });
    const tick = () => {
      const s = window.stb, img = $('orig-img'), now = performance.now();
      if (P.t0) {
        if (!P.loaded && s.loaded) P.loaded = now - P.t0;
        if (!P.orig && !img.hidden && img.complete && img.naturalWidth) P.orig = now - P.t0;
        if (!P.model && s.model) { P.model = now - P.t0; requestAnimationFrame(() => requestAnimationFrame(() => { P.frame = performance.now() - P.t0; })); }
        if (!P.built && P.model && !$('hint').hidden) P.built = now - P.t0;
      }
      if (!P.built) setTimeout(tick, 20);
    };
    tick();
  });
  return { ...o, cdp, slowdown: { before, after, ratio: +(after / before).toFixed(1), ...(wBefore ? { worker: [wBefore, wAfter] } : {}) } };
}
/** a fixed busy loop, ms: its ratio before/after throttling shows the slowdown is really on */
const calib = p => p.evaluate(() => { const t = performance.now(); let x = 0; for (let i = 0; i < 6e7; i++) x = (x + i * 7) % 1000003; return Math.round((performance.now() - t + (x < 0 ? 1 : 0)) / 3); });
/** the same loop in a worker: unchanged by the throttling (Chrome slows pages only: "only supported for pages, not workers") */
const calibWorker = p => p.evaluate(() => new Promise(r => {
  const w = new Worker(URL.createObjectURL(new Blob([`onmessage=()=>{const t=performance.now();let x=0;for(let i=0;i<6e7;i++)x=(x+i*7)%1000003;postMessage(Math.round((performance.now()-t+(x<0?1:0))/3))}`], { type: 'text/javascript' })));
  w.onmessage = e => { r(e.data); w.terminate(); }; w.postMessage(0);
}));
const heap = p => p.evaluate(() => ({ used: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1), total: +(performance.memory.totalJSHeapSize / 1e6).toFixed(1) }));

async function perf(b) {
  log(`\n===== 4. phone speed: ${PHONE.viewport.width}×${PHONE.viewport.height}, CPU ${RATE}× slower, Art Blocks answers from memory =====`);
  const R = report.perf, files = await (async () => { const { ctx, p } = await open(b, 'desktop'); await p.goto(BASE); const f = await pictures(p); await ctx.close(); return f; })();
  await warm(b);
  for (const mode of ['workers', 'main']) {
    log(mode === 'workers' ? `\n  as shipped: models built in workers (Chrome cannot slow workers down: their jobs' time is also counted ×${RATE})` : '\n  no Worker: every build and trace on the slowed main thread (upper bound)');
    const runs = [...PERF_IDS.map(id => ['script', id, '']), ...PERF_FALLBACKS];
    for (const [want, id, q] of runs) await retry(`perf ${want} #${id}`, async () => {
      const { ctx, p, errs, reloads, slowdown } = await phonePage(b, mode === 'main', q);
      const r0 = reloads();
      if (want === 'upload') await p.setInputFiles('#file', files.phone);
      else { await p.fill('#sq-number', String(id)); await p.click('.go'); }
      await p.waitForFunction(() => window.__perf.frame, null, { timeout: 300000 });
      const P = await p.evaluate(() => window.__perf);
      // the worker jobs on the way to the first model (trace, the Large Frame), counted as if slowed too
      const jobs = mode === 'workers' ? await p.evaluate(() => { const P = window.__perf; return window.__wjobs.filter(j => j.at <= P.t0 + P.model + 1).map(j => ({ what: j.what, ms: j.ms })); }) : [];
      const wms = jobs.reduce((a, j) => a + j.ms, 0), est = P.frame + (RATE - 1) * wms;
      const s = await state(p), name = want === 'script' ? `#${id}` : `${want} #${id}`;
      (R[mode] ??= {})[want === 'script' ? id : `${want}-${id}`] = { origin: s.origin, type: s.type, points: s.points, load: Math.round(P.loaded), original: Math.round(P.orig), model: Math.round(P.model), frame: Math.round(P.frame), built: P.built ? Math.round(P.built) : null, workerJobs: jobs, workerMs: wms, phoneEstimate: Math.round(est), steps: P.busy, pieces: s.model.pieces, slowdown };
      check(s.origin === want && est < BUDGET && reloads() === r0, `${mode} ${name} ${s.origin} ${s.type}: ${want === 'upload' ? 'picture chosen' : 'Build'} → original ${s1(P.orig)} → first model on screen ${s1(P.frame)}${mode === 'workers' ? ` (worker ${jobs.map(j => `${j.what} ${j.ms}`).join(' + ')} ms unslowed → phone ≈ ${s1(est)})` : ''} · load ${s1(P.loaded)}, build+show ${s1(P.frame - P.loaded)} · ${s.model.pieces} pieces · busy loop ${slowdown.before} → ${slowdown.after} ms (×${slowdown.ratio})${slowdown.worker ? `, in a worker ${slowdown.worker.join(' → ')} ms` : ''}${reloads() !== r0 ? ' · PAGE RELOADED (HMR)' : ''}`);
      if (slowdown.ratio < RATE * 0.6) check(false, `${mode} ${name}: the CPU slowdown is only ×${slowdown.ratio}, not ×${RATE}`);
      if (errs.length) check(false, `perf ${name}: page errors ${errs.join(' | ')}`);
      await ctx.close();
    });
    save();
  }
}

/** #1234 on the slowed phone: 10 switches of display, format and size, twice (time of each, JS heap), then the PDF */
async function phone(b) {
  log(`\n===== 5. switches, memory and the PDF: phone, CPU ${RATE}× slower, workers as shipped =====`);
  await warm(b);
  const { ctx, p, cdp, errs, slowdown } = await phonePage(b, false), row = report.phone = { slowdown }, T = Date.now(), at = () => `[${s1(Date.now() - T)}]`;
  await p.fill('#sq-number', '1234'); await p.click('.go');
  await p.waitForFunction(() => window.__perf.built, null, { timeout: 300000 });
  log(`  ${at()} first model on screen ${s1(await p.evaluate(() => window.__perf.frame))}, animation over`);
  await p.waitForTimeout(4000);
  // a round trip: back on the Large Frame, the Mosaic back to 96×48 (each format keeps its own size)
  const SEQ = [['.disp[data-display="floating"]', 'relief-floating-large'], ['.disp[data-display="backdrop"]', 'relief-backdrop-large'], ['[data-format="mosaic"]', 'mosaic--large'],
    ['[data-scale="small"]', 'mosaic--small'], ['[data-scale="large"]', 'mosaic--large'], ['[data-format="relief"]', 'relief-backdrop-large'], ['[data-scale="small"]', 'relief-backdrop-small'],
    ['.disp[data-display="floating"]', 'relief-floating-small'], ['.disp[data-display="frame"]', 'relief-frame-small'], ['[data-scale="large"]', 'relief-frame-large']];
  await cdp.send('HeapProfiler.enable');
  await within(60000, 'GC', cdp.send('HeapProfiler.collectGarbage'));
  row.heap = { start: await heap(p) };
  row.switches = [];
  for (const round of [1, 2]) {
    for (const [sel, key] of SEQ) {
      const r = await within(90000, `switch to ${key}`, p.evaluate(async ([sel, key]) => {
        const s = window.stb, b = s.builds, [format, display, scale] = key.split('-');
        const ready = !!(format === 'mosaic' ? b.mosaic[scale] : b.relief[scale]?.[display]);
        const t0 = performance.now();
        document.querySelector(sel).click();
        const ok = await new Promise(r => { const f = () => { const m = s.model; return m && `${m.format}-${m.display ?? ''}-${m.scale}` === key && document.getElementById('busy').hidden ? r(true) : performance.now() - t0 > 80000 ? r(false) : setTimeout(f, 15); }; f(); });
        const shown = performance.now() - t0;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const m = s.model;
        return { key, ok, now: m && `${m.format}-${m.display ?? ''}-${m.scale}`, ready, shown: Math.round(shown), frame: Math.round(performance.now() - t0), workerMs: b.ms[key] ?? null };
      }, [sel, key]));
      r.round = round;
      row.switches.push(r);
      log(`  ${at()} round ${round} switch → ${key.replace('--', '-')}: ${r.ok ? `on screen in ${s1(r.frame)}` : `NOT SHOWN after ${s1(r.frame)} (showing ${r.now})`}${r.ready ? ' (built in the background already)' : ` (built on click: worker ${r.workerMs} ms unslowed → phone ≈ ${s1(r.frame + (RATE - 1) * (r.workerMs ?? 0))})`}`);
      await p.waitForTimeout(round === 1 ? 3500 : 1500);
    }
    await within(60000, 'GC', cdp.send('HeapProfiler.collectGarbage'));
    row.heap[`after${round * 10}`] = await heap(p);
    log(`  ${at()} heap after ${round * 10} switches and GC: ${row.heap[`after${round * 10}`].used} MB`);
    save();
  }
  const r1 = row.switches.filter(s => s.round === 1), worst = Math.max(...r1.map(s => s.frame + (s.ready ? 0 : (RATE - 1) * (s.workerMs ?? 0))));
  check(row.switches.every(s => s.ok) && worst < BUDGET, `switches (round 1): slowest ${s1(worst)} to the new model on screen (phone estimate); round 2 (all built): ${row.switches.filter(s => s.round === 2).map(s => s1(s.frame)).join(', ')}`);
  const h = row.heap;
  check(h.after20.used - h.after10.used < 15, `JS heap after GC: ${h.start.used} MB at the first model → ${h.after10.used} MB after 10 switches → ${h.after20.used} MB after 20 (page only; workers and WebGL apart)`);
  // the PDF of the Large Frame, CPU still slowed; its progress line every 30 s
  row.pdfSlowdown = await calib(p);
  log(`  ${at()} busy loop before the PDF: ${row.pdfSlowdown} ms (unslowed ${slowdown.before} ms: ×${(row.pdfSlowdown / slowdown.before).toFixed(1)})`);
  const t = Date.now(), LIMIT = 20 * 60000;
  const dl = p.waitForEvent('download', { timeout: LIMIT });
  await p.evaluate(() => { window.__perf.progress = []; document.getElementById('dl-pdf').click(); });
  log(`  ${at()} PDF asked`);
  let d = null;
  const poll = setInterval(() => p.evaluate(() => document.getElementById('progress-text').textContent).then(x => log(`  ${at()} PDF: ${x}`), () => {}), 30000);
  try { d = await dl; } catch { /* too long */ }
  clearInterval(poll);
  const pdfMs = Date.now() - t, progress = await p.evaluate(() => window.__perf.progress).catch(() => []);
  if (!d) { row.pdf = { ms: pdfMs, done: false, progress }; check(false, `PDF of the Large Frame on the slowed phone: not done after ${s1(pdfMs)} (last: ${progress.at(-1)?.[1]})`); }
  else {
    const file = path.join(OUT, `phone-${d.suggestedFilename()}`);
    await d.saveAs(file);
    const pages = (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const first = progress.find(x => /page 1 of/.test(x[1]))?.[0], last = progress.filter(x => /Drawing page/.test(x[1])).at(-1)?.[0];
    row.pdf = { ms: pdfMs, pages, mb: +(fs.statSync(file).size / 1e6).toFixed(1), heapAfter: await heap(p), perPage: first && last ? Math.round((last - first) / Math.max(1, pages - 1)) : null };
    check(pdfMs < 120000, `PDF of the Large Frame on the slowed phone: ${s1(pdfMs)} for ${pages} pages (≈ ${s1(row.pdf.perPage ?? 0)} a page), ${row.pdf.mb} MB, heap ${row.pdf.heapAfter.used} MB after`);
    // the same PDF unslowed: how much of it the CPU slowdown reaches (WebGL and canvas drawing run in the GPU process)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const t1 = Date.now(), d1 = p.waitForEvent('download', { timeout: LIMIT });
    await p.evaluate(() => document.getElementById('dl-pdf').click());
    await d1;
    row.pdf.unslowedMs = Date.now() - t1;
    log(`  ${at()} the same PDF unslowed: ${s1(row.pdf.unslowedMs)} (slowed ×${(pdfMs / row.pdf.unslowedMs).toFixed(1)})`);
  }
  if (errs.length) check(false, `phone session: page errors ${errs.join(' | ')}`);
  save();
  await ctx.close();
}

/** one sheet of every picture taken (paths, uploads, More info, offline, diffs), captioned */
async function sheet(b) {
  const { summary: sum, runs } = JSON.parse(fs.readFileSync(REPORT, 'utf8'));   // this run merged with the parts not run
  const order = [/^path-/, /^upload-/, /^more-info-/, /^full-failure/, /^mobile-/, /^offline-/, /^junk-/, /^diff-/];
  const pics = fs.readdirSync(OUT).filter(f => f.endsWith('.png') && order.some(r => r.test(f)))
    .sort((a, c) => order.findIndex(r => r.test(a)) - order.findIndex(r => r.test(c)) || a.localeCompare(c));
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:16px;font:13px system-ui;background:#f4f4f5}main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
figure{margin:0;background:#fff;padding:8px;border-radius:6px}img{width:100%;display:block}figcaption{margin-top:6px;color:#333}</style>
<h1 style="font-size:18px">qa-fallbacks · ${sum.failed} of ${sum.checks} checks failed (run: ${Object.entries(runs).map(([k, v]) => `${k} ${v}`).join(', ')})</h1>
<main>${pics.map(f => `<figure><img src="${f}"><figcaption>${f.replace(/\.png$/, '')}</figcaption></figure>`).join('')}</main>`;
  fs.writeFileSync(path.join(OUT, 'sheet.html'), html);
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await p.goto('file://' + path.resolve(OUT, 'sheet.html')); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'sheet.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  await p.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--disable-features=IsolateSandboxedIframes'] });
  const t = Date.now();
  try {
    if (ONLY.includes('paths')) { SECTION = 'paths'; await paths(b); }
    if (ONLY.includes('mobile')) { SECTION = 'mobile'; await mobile(b); }
    if (ONLY.includes('offline')) { SECTION = 'offline'; await offline(b); }
    if (ONLY.includes('robust')) { SECTION = 'robust'; await robust(b); }
    if (ONLY.includes('perf')) { SECTION = 'perf'; await perf(b); }
    if (ONLY.includes('phone')) { SECTION = 'phone'; await phone(b); }
  } catch (e) { check(false, `stopped: ${e.message.split('\n')[0]}`); console.error(e); }
  const bad = report.checks.filter(c => !c.ok);
  report.summary = { ran: ONLY, seconds: Math.round((Date.now() - t) / 1000), thisRun: { checks: report.checks.length, failed: bad.length } };
  save();
  await sheet(b).catch(e => log(`sheet: ${e.message}`));
  await b.close();
  log(`\n${bad.length ? `${bad.length} of ${report.checks.length} checks FAILED:\n- ${bad.map(c => c.what).join('\n- ')}` : `All ${report.checks.length} checks passed.`}\nReport ${REPORT}`);
  process.exit(bad.length ? 1 : 0);
})();
