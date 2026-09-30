// Independent user-flow QA: walks the site as a visitor would, on desktop (1400×900) and on a phone
// (390×844, touch, mobile UA): first visit → wrong numbers → #1234 → the Frame builds → every control →
// the section menu → the reader → every download, each file checked (PDF pages, ZIP listing, XML,
// Pick a Brick bytes, PNG sizes, videos played back) → the order flow → Share on X → an example chip,
// a second Squiggle, back/forward/reload, the fallbacks; then edge numbers, quick changes of mind, the
// Mosaic / Floating / Backdrop files, a video while switching models, the example row swiped on the phone.
// Screenshots, files and report.json in out/qa/r4/. The page is loaded without the HMR client, so edits
// made meanwhile don't reload it mid-walk. --steps a,b runs only those steps (into out/qa/r4/<device>-steps).
//   node scripts/qa-flow.cjs [--only desktop|mobile] [--steps a,b] [--no-video] [--no-extras] [--url http://localhost:5180/] [--out out/qa/r4]
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { exe } = require('./shot.cjs');

const args = process.argv.slice(2), flag = k => args.includes('--' + k), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', 'http://localhost:5180/'), ROOT = opt('out', 'out/qa/r4');
const HMR_STUB = `export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, invalidate() {}, on() {}, off() {}, send() {}, data: {} });
export const updateStyle = (id, css) => { let s = document.querySelector('style[data-qa-id="' + id + '"]'); if (!s) { s = document.createElement('style'); s.dataset.qaId = id; document.head.append(s); } s.textContent = css; };
export const removeStyle = id => document.querySelector('style[data-qa-id="' + id + '"]')?.remove();
export const injectQuery = u => u; export class ErrorOverlay {}`;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DEVICES = {
  desktop: { viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_UA },
};
const report = { base: BASE, started: new Date().toISOString(), devices: {} };

// ---------- file checks (no dependencies) ----------
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function pngInfo(f) {
  const b = fs.readFileSync(f);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  const out = { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length, dpi: null };
  for (let o = 8; o < b.length - 12;) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    if (type === 'pHYs' && b[o + 16] === 1) out.dpi = Math.round(b.readUInt32BE(o + 8) * 0.0254);
    if (type === 'IDAT') break;
    o += 12 + len;
  }
  return out;
}
function pdfInfo(f) {
  const b = fs.readFileSync(f), s = b.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length, count = +(s.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/) || s.match(/\/Count\s+(\d+)/) || [])[1];
  return { header: s.slice(0, 8), eof: /%%EOF\s*$/.test(s.slice(-32)), pages, count, bytes: b.length, title: (s.match(/\/Title\s*\(([^)]*)\)/) || [])[1] ?? null };
}
/** the JPEG page pictures of a jsPDF booklet, in order */
function pdfJpegs(f) {
  const b = fs.readFileSync(f), s = b.toString('latin1'), out = [];
  const re = /<<([^>]*?\/DCTDecode[^>]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const len = +(m[1].match(/\/Length\s+(\d+)/) || [])[1], start = m.index + m[0].length;
    let data = b.subarray(start, start + len);
    if (/FlateDecode/.test(m[1])) try { data = zlib.inflateSync(data); } catch { continue; }
    out.push(data);
  }
  return out;
}
function unzipList(f) {
  const t = sh('unzip', ['-l', f]);
  return t.split('\n').map(l => l.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/)).filter(Boolean).map(m => ({ size: +m[1], name: m[2].trim() })).filter(e => e.name !== 'Name' && !/^-+$/.test(e.name) && !/files?$/.test(e.name));
}
function pabCheck(buf, expect) {
  const t = buf.toString('utf8'), errs = [];
  if (buf[0] === 0xef) errs.push('starts with a BOM');
  if (!t.startsWith('elementId,quantity\r\n')) errs.push(`header is ${JSON.stringify(t.slice(0, 24))}`);
  if (/[^\r]\n/.test(t) || /\n\n/.test(t)) errs.push('a line break is not CRLF');
  if (/\r?\n$/.test(t)) errs.push('ends with a line break');
  const lines = t.split('\r\n').slice(1), got = {};
  lines.forEach((l, i) => {
    const m = l.match(/^(\d+),(\d+)$/);
    if (!m) { errs.push(`line ${i + 2} ${JSON.stringify(l)}`); return; }
    if (+m[2] > 999 || +m[2] < 1) errs.push(`line ${i + 2} quantity ${m[2]}`);
    got[m[1]] = (got[m[1]] || 0) + +m[2];
  });
  if (lines.length > 400) errs.push(`${lines.length} lines (> 400)`);
  if (expect) {
    for (const [id, q] of Object.entries(expect)) if (got[id] !== q) errs.push(`element ${id}: ${got[id] ?? 0} in the file, ${q} in the model`);
    for (const id of Object.keys(got)) if (!(id in expect)) errs.push(`element ${id} not in the model`);
  }
  return { lines: lines.length, pieces: Object.values(got).reduce((a, b) => a + b, 0), errs };
}
function xmlCheck(text, expect) {
  const errs = [], f = path.join(ROOT, '.tmp.xml');
  fs.writeFileSync(f, text);
  try { sh('xmllint', ['--noout', f]); } catch (e) { errs.push('xmllint: ' + String(e.stderr || e.message).split('\n')[0]); }
  fs.rmSync(f, { force: true });
  const items = [...text.matchAll(/<ITEM>([\s\S]*?)<\/ITEM>/g)].map(m => {
    const g = k => (m[1].match(new RegExp(`<${k}>([^<]*)</${k}>`)) || [])[1];
    return { type: g('ITEMTYPE'), id: g('ITEMID'), color: g('COLOR'), qty: +g('MINQTY') };
  });
  const got = {};
  for (const it of items) { if (it.type !== 'P') errs.push(`ITEMTYPE ${it.type}`); got[`${it.id}|${it.color}`] = (got[`${it.id}|${it.color}`] || 0) + it.qty; }
  if (!/^<INVENTORY>/.test(text.trim())) errs.push('does not start with <INVENTORY>');
  if (expect) {
    for (const [k, q] of Object.entries(expect)) if (got[k] !== q) errs.push(`${k}: ${got[k] ?? 0} in the XML, ${q} in the model`);
    for (const k of Object.keys(got)) if (!(k in expect)) errs.push(`${k} not in the model`);
  }
  return { items: items.length, pieces: items.reduce((a, b) => a + b.qty, 0), errs };
}
function partsCsvCheck(text, exp) {
  const errs = [], rows = text.replace(/\r\n$/, '').split('\r\n');
  if (/[^\r]\n/.test(text)) errs.push('LF without CR');
  if (!/^Section,BrickLink part,Part,Colour/.test(rows[0])) errs.push(`header ${rows[0]}`);
  const body = rows.slice(1, -1), total = rows[rows.length - 1];
  if (body.length !== exp.lots) errs.push(`${body.length} lot rows, the model has ${exp.lots} lots`);
  if (!/^TOTAL,/.test(total)) errs.push(`last row ${total}`);
  const q = +(total.split(',')[5]);
  if (q !== exp.pieces) errs.push(`TOTAL ${q} pieces, the model has ${exp.pieces}`);
  const secs = new Set(body.map(r => r.split(',')[0]));
  if (!secs.has('Squiggle') || !secs.has('Display')) errs.push(`sections ${[...secs]}`);
  return { rows: rows.length, errs };
}
function ffprobe(f) {
  try {
    const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,channels,sample_rate', '-of', 'json', f]));
    return { duration: +j.format.duration, format: j.format.format_name, video: j.streams.find(s => s.codec_type === 'video'), audio: j.streams.find(s => s.codec_type === 'audio') };
  } catch (e) { return { error: String(e.message).split('\n')[0] }; }
}

// ---------- one device ----------
async function walk(browser, dev) {
  const mobile = dev === 'mobile', dir = path.join(ROOT, opt('steps') ? `${dev}-steps` : dev), files = path.join(dir, 'files');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(files, { recursive: true });
  const R = report.devices[opt('steps') ? `${dev}-steps` : dev] = { checks: [], console: [], failedRequests: [], hosts: [], timings: {}, taps: [], overflow: [], files: {}, lego: [] };
  const ctx = await browser.newContext({ ...DEVICES[dev], acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await ctx.route('**/@vite/client', r => r.fulfill({ contentType: 'application/javascript', body: HMR_STUB }));
  await ctx.route('**/__qa/*', r => { const f = decodeURIComponent(r.request().url().split('/__qa/')[1]); r.fulfill({ path: f }); });
  await ctx.addInitScript(() => {   // the session history as the page builds it (pushState/replaceState), for the Back/Forward checks
    const nav = window.__nav = { stack: [location.href], i: 0 }, push = history.pushState, rep = history.replaceState;
    history.pushState = function (st, t, u) { push.call(this, st, t, u); nav.stack = nav.stack.slice(0, nav.i + 1).concat(location.href); nav.i++; };
    history.replaceState = function (st, t, u) { rep.call(this, st, t, u); nav.stack[nav.i] = location.href; };
  });
  await ctx.addInitScript(() => {
    const log = window.__gl = [];
    for (const C of [HTMLCanvasElement, typeof OffscreenCanvas === 'undefined' ? null : OffscreenCanvas]) {
      if (!C) continue;
      const orig = C.prototype.getContext;
      C.prototype.getContext = function (t, ...a) {
        const c = orig.call(this, t, ...a);
        if (c && /webgl/.test(t) && !this.__qa) {
          const e = this.__qa = { at: Math.round(performance.now()), el: this.id || (C === HTMLCanvasElement ? (this.isConnected ? 'canvas (in page)' : 'canvas') : 'offscreen'), from: (new Error().stack || '').split('\n').slice(2, 7).map(s => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+/, '').replace(/\?[^:)]*/, '')).join(' < '), lost: false };
          log.push(e);
          this.addEventListener('webglcontextlost', () => { e.lost = true; e.lostAt = Math.round(performance.now()); });
        }
        return c;
      };
    }
  });
  const p = await ctx.newPage();
  const hosts = new Set();
  let cur = 'start';
  p.on('pageerror', e => R.console.push({ step: cur, type: 'pageerror', text: e.message, url: p.url() }));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') R.console.push({ step: cur, type: m.type(), text: m.text().slice(0, 300), url: p.url(), from: `${(m.location().url || '').replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}:${m.location().lineNumber}` }); });
  p.on('requestfailed', q => { if (!/\/__qa\/|^blob:/.test(q.url())) R.failedRequests.push({ step: cur, url: q.url().slice(0, 160), why: q.failure()?.errorText }); });
  p.on('response', r => { if (r.status() >= 400) R.failedRequests.push({ step: cur, url: r.url().slice(0, 160), status: r.status() }); });
  p.on('request', q => { try { hosts.add(new URL(q.url()).host); } catch { /* data: */ } });

  let n = 0;
  const log = (...a) => console.log(`[${dev}]`, ...a);
  const check = (ok, what, owner = 'page', evidence = '') => { R.checks.push({ ok: !!ok, what, owner, evidence: String(evidence).slice(0, 600) }); log(`${ok ? '✓' : '✗'} ${what}${ok || !evidence ? '' : ` — ${String(evidence).slice(0, 300)}`}`); return !!ok; };
  const shot = async (name, o = {}) => {
    const f = path.join(dir, `${String(++n).padStart(2, '0')}-${name}.png`);
    try { if (o.el) await p.locator(o.el).first().screenshot({ path: f }); else await p.screenshot({ path: f, fullPage: !!o.full }); } catch (e) { log('shot failed', name, e.message.split('\n')[0]); }
    return f;
  };
  R.gl = [];
  const glState = async (where) => {
    const g = await p.evaluate(() => ({ made: (window.__gl || []).length, alive: (window.__gl || []).filter(e => !e.lost).length, lost: (window.__gl || []).filter(e => e.lost).map(e => `${e.el}@${e.lostAt}`), live: document.getElementById('view')?.__qa ?? null, liveLost: (() => { const r = window.stb?.stage?.renderer; try { return r ? r.getContext().isContextLost() : null; } catch { return null; } })() })).catch(() => null);
    if (g) R.gl.push({ where, ...g });
    return g;
  };
  let liveLostReported = false;
  const only = opt('steps') ? opt('steps').split(',') : null;   // --steps a,b: run only those steps (they start from their own page)
  const step = async (name, fn) => {
    if (only && !only.includes(name)) return;
    const t0 = Date.now();
    cur = name;
    try { await fn(); } catch (e) { check(false, `${name} (the step threw)`, 'page', e.message.split('\n')[0]); await shot(`${name}-ERROR`); }
    R.timings[name] = Date.now() - t0;
    const g = await glState(name);
    if (g && g.liveLost && !liveLostReported) {
      liveLostReported = true;
      R.glLog = await p.evaluate(() => window.__gl.map(e => ({ at: e.at, el: e.el, lost: e.lost, lostAt: e.lostAt, from: e.from })));
      check(false, `the live 3D view keeps its WebGL context (lost during "${name}")`, 'motion', `${g.made} WebGL contexts created, ${g.alive} still alive; lost: ${g.lost.join(', ')}`);
      await p.locator('#sec-model').scrollIntoViewIfNeeded().catch(() => {});
      await shot(`${name}-live-view-lost`);
    }
  };
  const press = async (sel) => { const l = typeof sel === 'string' ? p.locator(sel).first() : sel; await l.scrollIntoViewIfNeeded(); if (mobile) await l.tap(); else await l.click(); };
  const st = () => p.evaluate(() => { const s = window.stb, m = s?.model; return m ? { id: s.loaded?.id ?? null, origin: s.loaded?.origin, format: m.format, display: m.display ?? null, scale: m.scale, pieces: m.pieces.length, lots: m.bom.length, steps: m.steps.length, playing: s.stage?.isPlaying, time: s.stage?.time, pages: s.maker?.total ?? null, cost: m.cost, grams: m.grams } : null; });
  const idle = (pred, arg, t = 120000) => p.waitForFunction(pred, arg, { timeout: t, polling: 150 });
  const shown = pred => idle(([f, d, s, id]) => { const x = window.stb; const m = x?.model; return m && document.getElementById('busy').hidden && m.format === f && (d === null || m.display === d) && m.scale === s && (id === undefined || x.loaded?.id === id); }, pred);
  const overflow = async (where) => {
    const o = await p.evaluate(() => {
      const iw = innerWidth, sw = document.documentElement.scrollWidth, bad = [];
      if (sw > iw) for (const e of document.querySelectorAll('body *')) {
        const r = e.getBoundingClientRect();
        if (r.width && r.right > iw + 1 && !e.closest('[hidden]')) bad.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''} right=${Math.round(r.right)}`);
      }
      return { iw, sw, bad: bad.slice(0, 10) };
    });
    R.overflow.push({ where, ...o });
    if (o.sw > o.iw) check(false, `no horizontal scroll (${where})`, 'page', `scrollWidth ${o.sw} > innerWidth ${o.iw}: ${o.bad.join(', ')}`);
    return o;
  };
  const taps = async (where) => {
    if (!mobile) return;
    const small = await p.evaluate(() => {
      const desc = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
      const out = [];
      for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]):not([type=file]), summary, select, label.linkbtn, [role=radio]')) {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]') || e.closest('dialog:not([open])') || e.closest('details:not([open]) > :not(summary)')) continue;
        const lab = e.closest('label'), lr = lab && lab !== e ? lab.getBoundingClientRect() : null;   // a checkbox is tapped through its label
        if (lr && Math.min(lr.width, lr.height) >= 40) continue;
        const inline = cs.display === 'inline' && (!!e.closest('p, li, figcaption, small') || (e.parentElement?.textContent.trim().length ?? 0) > (e.textContent ?? '').trim().length + 12);   // a link inside a sentence
        if (Math.min(r.width, r.height) < 40) out.push({ el: desc(e), w: +r.width.toFixed(1), h: +r.height.toFixed(1), inline, text: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) });
      }
      return out;
    });
    for (const s of small) if (!R.taps.some(t => t.el === s.el && t.text === s.text)) R.taps.push({ where, ...s });
  };
  const sample = sel => p.evaluate(s => {
    const src = document.querySelector(s), c = document.createElement('canvas'); c.width = 64; c.height = 40;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, 64, 40);
    return Array.from(x.getImageData(0, 0, 64, 40).data.filter((_, i) => i % 4 !== 3));
  }, sel);
  const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
  const blank = async sel => { const a = await sample(sel); return Math.max(...a) - Math.min(...a) < 12; };
  const download = async (name, trigger, timeout = 90000) => {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout }), trigger()]);
    const f = path.join(files, d.suggestedFilename());
    await d.saveAs(f);
    R.files[name] = { file: f, bytes: fs.statSync(f).size };
    return f;
  };
  const expected = () => p.evaluate(async () => {
    const { elementId } = await import('/src/core/lego.ts'), { brickLinkId } = await import('/src/export/parts.ts');
    const m = window.stb.model, pab = {}, bl = {};
    for (const l of m.bom) {
      const e = elementId(l.part, l.color);
      if (e) pab[e] = (pab[e] || 0) + l.qty;
      const k = `${brickLinkId(l.part)}|${l.color}`; bl[k] = (bl[k] || 0) + l.qty;
    }
    return { pab, bl, lots: m.bom.length, pieces: m.pieces.length, legoLots: m.bom.filter(l => elementId(l.part, l.color)).length, noId: m.bom.filter(l => !elementId(l.part, l.color)).map(l => `${l.part}/${l.color}`) };
  });
  const text = sel => p.locator(sel).first().innerText().catch(() => '');

  // ---- 1. first visit ----
  await step('first-visit', async () => {
    const t0 = Date.now();
    await p.goto(BASE, { waitUntil: 'load' });
    R.timings.load = Date.now() - t0;
    await p.waitForTimeout(1500);
    await shot('first-visit');
    await shot('first-visit-full', { full: true });
    check(await p.title() === 'Squiggle to Bricks', 'page title "Squiggle to Bricks"', 'page', await p.title());
    const lede = await text('.lede');
    check(lede === 'Build your Chromie Squiggle with real bricks. Free, unofficial, personal use.', 'subtitle exactly as decided', 'page', lede);
    await idle(() => [...document.querySelectorAll('#examples img')].every(i => i.complete), null, 15000).catch(() => {});
    check(await p.evaluate(() => { const i = document.querySelector('.hero-pic img'); return i.complete && i.naturalWidth > 0; }), 'hero picture loads', 'page');
    const ex = await p.evaluate(() => [...document.querySelectorAll('#examples button')].map(b => ({ t: b.innerText.replace(/\s+/g, ' '), ok: b.querySelector('img').complete && b.querySelector('img').naturalWidth > 0 })));
    check(ex.length === 5 && ['#1234', '#7583', '#3784', '#102', '#1000'].every((k, i) => ex[i]?.t.startsWith(k)), '5 example chips #1234 #7583 #3784 #102 #1000', 'page', JSON.stringify(ex));
    check(ex.every(e => e.ok), 'example thumbnails loaded from Art Blocks', 'page', JSON.stringify(ex));
    check(await p.locator('#result').isHidden(), 'no result section before a Squiggle is chosen');
    const foot = await text('footer');
    for (const k of ['Not affiliated with', 'Art Blocks', 'the LEGO Group', 'BrickLink', 'LEGO® is a trademark of the LEGO Group', 'Parts data: Rebrickable', 'computer-checked, not physically built', 'Personal use only', 'Disclaimer', 'MIT License', 'Source', 'Chromie Squiggle by Snowfro / Art Blocks. Made by John Karp. Inspired by @victormustar']) check(foot.includes(k), `footer says "${k}"`, 'page', foot.slice(0, 200));
    const vm = await p.locator('footer a', { hasText: '@victormustar' }).getAttribute('href');
    check(vm === 'https://x.com/victormustar', '@victormustar links to x.com/victormustar', 'page', vm);
    const src = await p.locator('footer a', { hasText: 'Source' }).getAttribute('href');
    check(src === 'https://github.com/hs7j4yk4sz-boop/squiggle-to-bricks', 'Source links to the repo', 'page', src);
    const cookies = await ctx.cookies();
    check(cookies.length === 0, 'no cookies set', 'page', JSON.stringify(cookies));
    R.heroCaption = await text('.hero-pic figcaption');
    const og = await p.evaluate(async () => { const r = await fetch('./og.png'); if (!r.ok) return { status: r.status }; const b = await createImageBitmap(await r.blob()); return { status: r.status, w: b.width, h: b.height }; }).catch(e => ({ error: e.message }));
    check(og.w === 1200 && og.h === 630, 'og.png is served, 1200 × 630', 'page', JSON.stringify(og));
    const ogMeta = await p.evaluate(() => [...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')].map(m => `${m.getAttribute('property') || m.getAttribute('name')}=${m.content}`));
    check(ogMeta.some(m => /^og:image=.*og\.png$/.test(m)) && ogMeta.some(m => m === 'twitter:card=summary_large_image'), 'OG / Twitter card tags point at og.png', 'page', ogMeta.join(' | '));
    check(await p.locator('#upload-link').isVisible(), '"or upload an image" link shown', 'page');
    await overflow('first visit'); await taps('first visit');
  });

  // ---- 2. wrong numbers ----
  await step('invalid-input', async () => {
    const field = p.locator('#sq-number');
    const tryIt = async (typed, how = 'type') => {
      await field.scrollIntoViewIfNeeded();
      await field.fill('');
      if (how === 'type') { await press(field); await p.keyboard.type(typed, { delay: 20 }); } else await field.fill(typed);
      const value = await field.inputValue();
      await press('#by-number button.go');
      await p.waitForTimeout(700);
      return { value, error: (await p.locator('#error').isVisible()) ? await text('#error-text') : null, result: await p.locator('#result').isVisible(), url: p.url() };
    };
    const empty = await tryIt('');
    check(empty.error && !empty.result, 'empty field → error, nothing built', 'page', JSON.stringify(empty));
    await shot('invalid-empty');
    const abc = await tryIt('abc');
    check(abc.error && !abc.result, '"abc" → error, nothing built', 'page', JSON.stringify(abc));
    const neg = await tryIt('-1');
    check(neg.error && !neg.result, '"-1" → error, nothing built', 'page', JSON.stringify(neg));
    await shot('invalid-minus1');
    const big = await tryIt('10000');
    R.tenThousand = { typed: big.value, build: big };
    check(big.error && !big.result && big.value === '10000', '"10000" typed + Build → error, nothing built (no silent #1000)', 'page', JSON.stringify(big));
    await shot('invalid-10000');
    const mixed = await tryIt('12a');
    check(mixed.error && !mixed.result, '"12a" → error, nothing built', 'page', JSON.stringify(mixed));
    const msg = String(big.error || '');
    check(/0 to 9999/.test(msg), 'the error says which numbers work (0 to 9999)', 'page', msg);
    check(!/[?&]id=/.test(p.url()), 'URL has no ?id after wrong numbers', 'page', p.url());
    await overflow('invalid input'); await taps('error shown');
  });

  // ---- 3. type 1234 → Build ----
  let first = null;
  await step('build-1234', async () => {
    await p.locator('#sq-number').fill('');
    await press('#sq-number'); await p.keyboard.type('1234');
    const t0 = Date.now();
    await press('#by-number button.go');
    await p.waitForTimeout(250);
    check(await p.locator('#error').isHidden(), 'the error goes away on a valid number', 'page');
    await shot('build-fetching');
    await idle(() => { const i = document.getElementById('orig-img'); return !i.hidden && i.complete && i.naturalWidth > 0; }, null, 60000);
    R.timings.toOriginal = Date.now() - t0;
    await shown(['relief', 'frame', 'large', 1234]);
    R.timings.toModel = Date.now() - t0;
    first = await st();
    R.first = first;
    check(first.format === 'relief' && first.display === 'frame' && first.scale === 'large', 'default model is the Large Frame', 'models', JSON.stringify(first));
    check(first.origin === 'script', 'loaded with its own script (origin script)', 'load', first.origin);
    check(first.playing, 'the build animation starts by itself', 'motion', JSON.stringify(first));
    check(/[?&]id=1234\b/.test(p.url()), 'URL becomes ?id=1234', 'page', p.url());
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await p.waitForTimeout(600);
    const a = await sample('#view'), ta = (await st()).time;
    await shot('frame-animating-a');
    await p.waitForTimeout(1500);
    const b = await sample('#view'), tb = (await st()).time;
    await shot('frame-animating-b');
    check(diff(a, b) > 1 && tb > ta, 'the 3D view changes while it builds (animation running)', 'motion', `pixel diff ${diff(a, b).toFixed(2)}, t ${ta?.toFixed(2)} → ${tb?.toFixed(2)} s`);
    const orig = await p.evaluate(() => ({ title: document.getElementById('orig-title').textContent, origin: document.getElementById('orig-origin').textContent, feats: [...document.querySelectorAll('#features dt')].map(d => d.textContent), link: document.getElementById('orig-link').href }));
    R.original = orig;
    check(orig.title === 'Chromie Squiggle #1234', 'original titled "Chromie Squiggle #1234"', 'page', orig.title);
    check(['Type', 'Spectrum', 'Segments'].every(k => orig.feats.includes(k)), 'original shows its Art Blocks features (Type, Spectrum, Segments…)', 'page', orig.feats.join(', '));
    check(/artblocks\.io\/token\/1\/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a\/1234$/.test(orig.link), '"View on Art Blocks" links to token 1234', 'page', orig.link);
    // wait for the end of the build
    await idle(() => !window.stb.stage.isPlaying, null, 60000);
    await p.waitForTimeout(700);
    await shot('frame-built');
    const stats = await text('#stats');
    R.stats1234 = stats;
    check(stats.includes(first.pieces.toLocaleString('en')) && /cm/.test(stats) && /≈ €\d+/.test(stats) && /(kg|g)\b/.test(stats), 'figures: pieces, cm, weight, ≈ € cost', 'page', stats.replace(/\n/g, ' | '));
    check(/estimate/i.test(stats) && /Pick a Brick/.test(stats), 'cost labelled as a Pick a Brick estimate', 'page', stats.replace(/\n/g, ' | '));
    const cm = (stats.match(/(\d+ × \d+(?: × \d+)?)\s*cm/) || [])[1];
    const hero = R.heroCaption || '';
    check(hero.includes(`${first.pieces} pieces`) && (!cm || hero.includes(`${cm} cm`)), 'the hero caption (#1234 · Large Frame · pieces · cm) matches the model built', 'page', `caption "${hero}" · model ${first.pieces} pieces, ${cm} cm`);
    const thumbs = await idle(() => [...document.querySelectorAll('.disp')].every(d => { const i = d.querySelector('img'); return !i.hidden && i.naturalWidth > 0 && /pieces/.test(d.querySelector('.dfig').textContent); }), null, 90000).then(() => true, () => false);
    const dfig = await p.evaluate(() => [...document.querySelectorAll('.disp')].map(d => `${d.dataset.display}: ${d.querySelector('.dfig').textContent} ${d.querySelector('img').hidden ? '(no picture)' : ''}`));
    check(thumbs && dfig.every(t => /pieces/.test(t) && /cm/.test(t)), 'the 3 display thumbnails show a picture, pieces and cm', 'models', dfig.join(' / '));
    await shot('displays', { el: '#displays' });
    const pill = await text('#pill');
    check(/Checked: solid/.test(pill), '"Checked: solid" pill', 'models', pill + ' ' + await text('#status-short'));
    await press('#more summary');
    await p.waitForTimeout(400);
    await shot('more-info');
    const more = await text('#more .more-body');
    check(/0 collisions/.test(more) && /0 floating/.test(more) && /Held by 2\+ studs/.test(more), 'More info lists the checks (0 collisions, 0 floating, held by 2+ studs)', 'models', more.slice(0, 300).replace(/\n/g, ' | '));
    await press('#more summary');
    await overflow('model built'); await taps('model built');
  });

  // ---- 4. the stage controls ----
  await step('stage-controls', async () => {
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    const cam = () => p.evaluate(() => window.stb.stage.camera.position.toArray().map(v => +v.toFixed(3)));
    check(await p.locator('#hint').isVisible() && await p.locator('#skip').isHidden() && await p.locator('#reset').isHidden(), 'after the build: the drag hint appears, Skip goes, no Reset yet', 'page', `hint ${await p.locator('#hint').isVisible()} skip ${await p.locator('#skip').isVisible()} reset ${await p.locator('#reset').isVisible()}`);
    await press('#replay');
    await p.waitForTimeout(300);
    check((await st()).playing, 'Replay plays the build again', 'motion', JSON.stringify(await st()));
    await p.waitForTimeout(800);
    await shot('replaying');
    await press('#skip');
    await p.waitForTimeout(500);
    const s = await st();
    check(!s.playing && s.time > 5, 'Skip shows the finished model', 'motion', JSON.stringify(s));
    const home = await cam();
    const box = await p.locator('#view').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (mobile) await touchDrag(p, cx - 60, cy, cx + 90, cy + 20);
    else { await p.mouse.move(cx, cy); await p.mouse.down(); for (let i = 1; i <= 12; i++) await p.mouse.move(cx + i * 15, cy + i * 3); await p.mouse.up(); }
    await p.waitForTimeout(800);
    const moved = await cam();
    const dist = Math.hypot(...moved.map((v, i) => v - home[i]));
    check(dist > 1, 'dragging turns the model', 'motion', `camera ${home} → ${moved}`);
    check(await p.locator('#reset').isVisible(), 'a drag shows "Reset view"', 'page');
    await shot('dragged');
    if (!mobile) {   // wheel zoom
      const d0 = await p.evaluate(() => window.stb.stage.camera.position.distanceTo(window.stb.stage.controls.target));
      await p.mouse.move(cx, cy); await p.mouse.wheel(0, -400); await p.waitForTimeout(900);
      const d1 = await p.evaluate(() => window.stb.stage.camera.position.distanceTo(window.stb.stage.controls.target));
      check(d1 < d0 - 0.5, 'the mouse wheel zooms in', 'motion', `distance ${d0.toFixed(1)} → ${d1.toFixed(1)}`);
      await shot('zoomed');
    }
    await press('#reset');
    await p.waitForTimeout(1200);
    const back = await cam();
    check(Math.hypot(...back.map((v, i) => v - home[i])) < 0.5, 'Reset view goes back to the default view', 'motion', `camera ${back} vs home ${home}`);
    check(await p.locator('#reset').isHidden(), '"Reset view" hides again after use', 'page');
    await shot('reset');
    // Frame: no auto-rotation when idle
    const c1 = await cam(); await p.waitForTimeout(1500); const c2 = await cam();
    check(Math.hypot(...c1.map((v, i) => v - c2[i])) < 0.01, 'the Frame stays still when idle (no auto-rotate)', 'motion', `${c1} → ${c2}`);
    if (mobile) {   // a vertical swipe that starts on the 3D view: does the page still scroll?
      const y0 = await p.evaluate(() => scrollY);
      await touchDrag(p, cx, cy + 40, cx + 4, cy - 160, 10);
      await p.waitForTimeout(600);
      const y1 = await p.evaluate(() => scrollY), vh = await p.evaluate(() => document.getElementById('view').getBoundingClientRect().height / innerHeight);
      R.scrollTrap = { y0, y1, viewShare: +vh.toFixed(2) };
      check(y1 !== y0 || vh < 0.4, 'a vertical swipe on the 3D view still scrolls the page (or the view is small)', 'page', `scrollY ${y0} → ${y1}, the 3D view is ${Math.round(vh * 100)} % of the screen height`);
      await p.evaluate(() => window.stb.stage.resetView(false));
    }
  });

  // ---- 5. format, displays, sizes ----
  const pick = async (sel, want, name) => {
    const before = await st();
    await press(sel);
    await shown(want);
    await p.waitForTimeout(300);
    const s = await st();
    const stats = await text('#stats'), sub = await text('#model-sub'), manual = await text('#manual-sub'), shop = await text('#shop-sum');
    const ok = stats.includes(s.pieces.toLocaleString('en')) && shop.includes(`${s.lots} lots`) && manual.includes(`${s.steps} steps`);
    check(ok, `${name}: model, figures, reader and shopping list follow (${s.pieces} pieces, ${s.lots} lots, ${s.steps} steps)`, 'page', `stats "${stats.replace(/\n/g, ' ')}" · manual "${manual}" · shop "${shop}" · sub "${sub}"`);
    const radios = await p.evaluate(() => [...document.querySelectorAll('[role=radio][aria-checked=true]')].map(b => b.dataset.format || b.dataset.display || b.dataset.scale));
    R.picks = R.picks || []; R.picks.push({ name, state: s, radios, sub });
    // the labels on the picker agree with the figures of the model shown
    const cm = (stats.match(/(\d+ × \d+(?: × \d+)?)\s*cm/) || [])[1];
    const lab = await p.evaluate(() => ({ scale: document.querySelector('[data-scale][aria-checked=true] small')?.textContent ?? '', disp: document.querySelector('.disp[aria-checked=true] .dfig')?.textContent ?? '' }));
    check(!cm || lab.scale.replace(/\s+/g, ' ').includes(`${cm}`), `${name}: the chosen size button shows the model's size (${cm} cm)`, 'page', `size button "${lab.scale}", figures ${cm}`);
    if (s.format === 'relief') check(lab.disp.includes(`${s.pieces.toLocaleString('en')} pieces`) && (!cm || lab.disp.includes(cm)), `${name}: the chosen display thumbnail shows its pieces and cm`, 'page', `thumbnail "${lab.disp}", model ${s.pieces} pieces ${cm} cm`);
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1200);
    await shot(name);
    return { before, s, radios };
  };
  await step('switch-models', async () => {
    let r = await pick('.disp[data-display=floating]', ['relief', 'floating', 'large'], 'floating-large');
    check(r.radios.includes('floating') && r.radios.includes('relief') && r.radios.includes('large'), 'Floating is marked as chosen', 'page', r.radios.join(','));
    check(r.s.playing, 'a newly chosen model plays its build', 'motion', JSON.stringify(r.s));
    r = await pick('.disp[data-display=backdrop]', ['relief', 'backdrop', 'large'], 'backdrop-large');
    r = await pick('[data-scale=small]', ['relief', 'backdrop', 'small'], 'backdrop-small');
    check(r.s.pieces < r.before.pieces, 'Small has fewer pieces than Large', 'models', `${r.before.pieces} → ${r.s.pieces}`);
    const scaleTxt = await text('#scales');
    check(/Large/.test(scaleTxt) && /Small/.test(scaleTxt) && /cm/.test(scaleTxt), 'Large | Small show their size', 'page', scaleTxt.replace(/\n/g, ' '));
    r = await pick('.disp[data-display=frame]', ['relief', 'frame', 'small'], 'frame-small');
    const thumbFig = await p.evaluate(() => [...document.querySelectorAll('.disp .dfig')].map(d => d.textContent));
    R.thumbsSmall = thumbFig;
    r = await pick('[data-format=mosaic]', ['mosaic', null, 'large'], 'mosaic-96x48');
    check(await p.locator('#displays').isHidden(), 'Mosaic hides the display thumbnails', 'page');
    const ms = await text('#scales');
    check(/96 × 48/.test(ms) && /64 × 32/.test(ms), 'Mosaic sizes 96 × 48 | 64 × 32', 'page', ms.replace(/\n/g, ' '));
    r = await pick('[data-scale=small]', ['mosaic', null, 'small'], 'mosaic-64x32');
    r = await pick('[data-format=relief]', ['relief', 'frame', 'small'], 'back-to-relief');
    check(r.radios.includes('frame') && r.radios.includes('small'), 'back to Relief keeps Frame · Small', 'page', r.radios.join(','));
    check(!r.s.playing, 'a model already seen is not replayed (shown finished)', 'motion', JSON.stringify(r.s));
    r = await pick('[data-scale=large]', ['relief', 'frame', 'large'], 'frame-large-again');
    await idle(() => !window.stb.stage.isPlaying, null, 30000).catch(() => {});
    await overflow('models switched'); await taps('models switched');
  });

  // ---- 6. section menu ----
  await step('section-nav', async () => {
    check(await p.locator('#secnav').isVisible(), 'the section menu is shown', 'page');
    for (const id of ['sec-buy', 'sec-manual', 'sec-model']) {
      await press(`#secnav a[data-sec=${id}]`);
      await p.waitForTimeout(1300);
      const r = await p.evaluate(i => ({ top: Math.round(document.getElementById(i).getBoundingClientRect().top), nav: Math.round(document.getElementById('secnav').getBoundingClientRect().bottom), on: document.querySelector('#secnav a.on')?.dataset.sec, hash: location.hash }), id);
      check(r.top >= -2 && r.top <= 130 && r.on === id, `menu → ${id}: the section comes to the top and its link lights up`, 'page', JSON.stringify(r));
      if (r.top < r.nav - 2) check(false, `menu → ${id}: the sticky menu covers the section's top`, 'page', JSON.stringify(r));
      await shot(`nav-${id}`);
    }
    // the menu follows a plain scroll too (no click): the section in the middle of the screen lights up
    for (const id of ['sec-manual', 'sec-buy', 'sec-model']) {
      await p.evaluate(i => { const e = document.getElementById(i); scrollTo({ top: scrollY + e.getBoundingClientRect().top + Math.min(e.offsetHeight, innerHeight) * 0.3 - 60, behavior: 'instant' }); }, id);
      await p.waitForTimeout(500);
      const on = await p.evaluate(() => document.querySelector('#secnav a.on')?.dataset.sec ?? null);
      check(on === id, `scrolling to ${id} (no click) lights its menu link`, 'page', `lit: ${on}`);
    }
  });

  // ---- 7. the reader ----
  await step('reader', async () => {
    await p.locator('#sec-manual').scrollIntoViewIfNeeded();
    await idle(() => { const c = document.getElementById('page-canvas'), x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < d.length; i += 4 * 997) if (d[i] < 200) k++; return k > 20; }, null, 60000);
    const s = await st();
    const lab = async () => (await text('#pg-label')).trim();
    check(await lab() === 'Cover', 'the reader opens on the Cover', 'booklet', await lab());
    check(+(await p.locator('#pg-range').getAttribute('max')) === s.pages, `slider has ${s.pages} pages`, 'booklet', await p.locator('#pg-range').getAttribute('max'));
    await shot('reader-cover', { el: '.reader' });
    const c1 = await sample('#page-canvas');
    await press('#pg-next');
    await p.waitForTimeout(1500);
    const l2 = await lab(), c2 = await sample('#page-canvas');
    check(l2 !== 'Cover' && diff(c1, c2) > 1, 'next → page 2 drawn', 'booklet', `${l2}, diff ${diff(c1, c2).toFixed(1)}`);
    await shot('reader-p2', { el: '.reader' });
    await press('#pg-prev');
    await p.waitForTimeout(800);
    check(await lab() === 'Cover' && await p.locator('#pg-prev').isDisabled(), 'prev → back on the Cover, prev disabled', 'booklet', await lab());
    // slider: click (tap) on the track at 60 %
    const rb = await p.locator('#pg-range').boundingBox();
    const at = { x: rb.x + rb.width * 0.6, y: rb.y + rb.height / 2 };
    if (mobile) await p.touchscreen.tap(at.x, at.y); else await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(1800);
    const v = +(await p.locator('#pg-range').inputValue());
    check(v > 1 && /Step \d+ of \d+/.test(await lab()), 'slider jumps to a step page', 'booklet', `value ${v}, label "${await lab()}"`);
    await shot('reader-slider', { el: '.reader' });
    // thumbnails: the last one (finished model), then step 3
    const thumbs = p.locator('#thumbs button');
    check(await thumbs.count() === s.pages, 'one thumbnail per page', 'booklet', await thumbs.count());
    await press(thumbs.last());
    await p.waitForTimeout(1800);
    check(await p.locator('#pg-next').isDisabled(), 'last thumbnail → last page, next disabled', 'booklet', await lab());
    await shot('reader-last', { el: '.reader' });
    const labels = await p.evaluate(() => [...document.querySelectorAll('#thumbs button')].map(b => b.textContent));
    R.readerLabels = labels;
    for (const k of ['Cover', 'Hanging', 'Nameplate']) check(labels.some(l => l.includes(k)), `reader has a "${k}" page`, 'booklet', labels.join(', '));
    const hang = labels.findIndex(l => /Hanging/.test(l));
    if (hang >= 0) { await press(thumbs.nth(hang)); await p.waitForTimeout(1800); await shot('reader-hanging', { el: '.reader' }); }
    const np = labels.findIndex(l => /Nameplate/.test(l));
    if (np >= 0) { await press(thumbs.nth(np)); await p.waitForTimeout(1800); await shot('reader-nameplate', { el: '.reader' }); }
    const parts = labels.findIndex(l => /Parts/i.test(l));
    if (parts >= 0) { await press(thumbs.nth(parts)); await p.waitForTimeout(1800); await shot('reader-parts', { el: '.reader' }); }
    await press(thumbs.nth(3));
    await p.waitForTimeout(1500);
    // keyboard (desktop) or swipe (phone)
    const before = await lab();
    if (mobile) { const pb = await p.locator('#page-view').boundingBox(); await touchDrag(p, pb.x + pb.width * 0.8, pb.y + pb.height / 2, pb.x + pb.width * 0.2, pb.y + pb.height / 2 + 5, 8); }
    else { await p.locator('#page-view').focus(); await p.keyboard.press('ArrowRight'); }
    await p.waitForTimeout(1500);
    check(await lab() !== before, mobile ? 'a swipe on the page turns it' : 'the → key turns the page', 'booklet', `${before} → ${await lab()}`);
    const drawnThumbs = await p.evaluate(() => [...document.querySelectorAll('#thumbs canvas')].filter(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 400) if (d[i] < 200) return true; return false; }).length);
    check(drawnThumbs >= 3, 'thumbnails near the view are drawn', 'booklet', `${drawnThumbs} drawn`);
    await overflow('reader'); await taps('reader');
  });

  // ---- 8. downloads ----
  const exp = !(await p.evaluate(() => !!window.stb?.model).catch(() => false)) ? null : await expected().catch(e => { check(false, 'reading the model for the file checks', 'page', e.message); return null; });
  R.expected = exp && { lots: exp.lots, pieces: exp.pieces, legoLots: exp.legoLots, noId: exp.noId };
  if (exp) check(exp.noId.length === 0, 'every lot has a LEGO Element ID', 'exports', exp.noId.join(', '));
  await step('download-pdf', async () => {
    const s = await st();
    const t0 = Date.now();
    const f = await download('pdf', () => press('#dl-pdf'), 180000);
    R.timings.pdfMs = Date.now() - t0;
    const i = pdfInfo(f); R.files.pdf.info = i;
    check(f.endsWith('squiggle-1234-frame-large-instructions.pdf'), 'PDF file name', 'exports', path.basename(f));
    check(i.header.startsWith('%PDF-') && i.eof, 'PDF has %PDF header and %%EOF', 'booklet', JSON.stringify(i));
    check(i.pages === s.pages && i.count === s.pages, `PDF has ${s.pages} pages like the reader`, 'booklet', `/Type /Page ×${i.pages}, /Count ${i.count}`);
    check(i.bytes > 200e3 && i.bytes < 60e6, 'PDF size plausible', 'booklet', `${(i.bytes / 1e6).toFixed(1)} MB`);
    const jp = pdfJpegs(f);
    check(jp.length >= s.pages, 'every PDF page carries its picture', 'booklet', `${jp.length} JPEG streams`);
    const pick = [0, 1, 2, Math.floor(jp.length / 2), jp.length - 3, jp.length - 2, jp.length - 1].filter((v, k, a) => v >= 0 && a.indexOf(v) === k);
    for (const k of pick) if (jp[k]) fs.writeFileSync(path.join(files, `pdf-page-${k + 1}.jpg`), jp[k]);
    await p.waitForTimeout(500);
    check(await p.locator('#progress').isHidden(), 'the progress toast goes away after the PDF', 'page');
  });
  await step('download-kit', async () => {
    const f = await download('kit', () => press('#dl-kit'), 240000);
    const list = unzipList(f); R.files.kit.list = list;
    const base = 'squiggle-1234-frame-large';
    const want = [`${base}-instructions.pdf`, `${base}-parts.csv`, `${base}-pick-a-brick.csv`, `${base}-bricklink.xml`, `${base}-nameplate.png`, `${base}-nameplate-cut-marks.png`, `${base}-share.png`, 'README.txt'];
    const names = list.map(e => e.name);
    check(want.every(w => names.includes(w)), 'kit ZIP lists PDF, parts CSV, Pick a Brick CSV, XML, 2 nameplates, share image, README', 'exports', names.join(', '));
    check(list.every(e => e.size > 0), 'no empty file in the kit', 'exports', list.map(e => `${e.name} ${e.size}`).join(', '));
    const x = path.join(files, 'kit'); fs.rmSync(x, { recursive: true, force: true });
    sh('unzip', ['-q', '-o', f, '-d', x]);
    const pi = pdfInfo(path.join(x, `${base}-instructions.pdf`));
    check(pi.header.startsWith('%PDF-') && pi.pages === (await st()).pages, 'the kit PDF opens (header, pages)', 'exports', JSON.stringify(pi));
    const share = pngInfo(path.join(x, `${base}-share.png`));
    check(share && share.w === 1200 && share.h === 630, 'kit share image 1200 × 630', 'exports', JSON.stringify(share));
    const np = pngInfo(path.join(x, `${base}-nameplate.png`));
    check(np && np.w === 1129 && np.h === 373 && np.dpi === 600, 'kit nameplate PNG 47.8 × 15.8 mm at 600 dpi (1129 × 373)', 'exports', JSON.stringify(np));
    if (exp) {
      const pab = pabCheck(fs.readFileSync(path.join(x, `${base}-pick-a-brick.csv`)), exp.pab);
      check(!pab.errs.length, 'kit Pick a Brick CSV exact', 'exports', pab.errs.join('; '));
      const xml = xmlCheck(fs.readFileSync(path.join(x, `${base}-bricklink.xml`), 'utf8'), exp.bl);
      check(!xml.errs.length, 'kit BrickLink XML valid and complete', 'exports', xml.errs.join('; '));
      const csv = partsCsvCheck(fs.readFileSync(path.join(x, `${base}-parts.csv`), 'utf8'), exp);
      check(!csv.errs.length, 'kit parts CSV complete', 'exports', csv.errs.join('; '));
    }
    const readme = fs.readFileSync(path.join(x, 'README.txt'), 'utf8');
    R.files.kit.readmeHead = readme.split('\r\n').slice(0, 6);
    check(/Chromie Squiggle #1234/.test(readme) && /HOW TO ORDER/.test(readme) && /HANGING THE FRAME/.test(readme) && /Not affiliated/.test(readme), 'README: name, how to order, hanging, disclaimer', 'exports', readme.slice(0, 200));
    check(!/\bLEGO (Squiggle|kit|set|model)/i.test(readme), 'README never names the product "LEGO …"', 'exports', (readme.match(/LEGO \w+/g) || []).join(', '));
  });
  await step('download-nameplate', async () => {
    const f = await download('nameplate', () => press('#dl-nameplate'));
    const i = pngInfo(f); R.files.nameplate.info = i;
    check(i && i.dpi === 600 && i.w > 1129 && i.h > 373, 'nameplate PNG with cut marks, 600 dpi, larger than the plate', 'exports', `${path.basename(f)} ${JSON.stringify(i)}`);
  });
  await step('download-share', async () => {
    const f = await download('share', () => press('#dl-share'));
    const i = pngInfo(f); R.files.share.info = i;
    check(i && i.w === 1200 && i.h === 630, 'share image PNG 1200 × 630', 'exports', `${path.basename(f)} ${JSON.stringify(i)}`);
  });
  if (!flag('no-video')) for (const fmt of ['square', 'story']) await step(`video-${fmt}`, async () => {
    const t0 = Date.now();
    const midShots = [];
    const f = await download(`video-${fmt}`, async () => {
      await press(fmt === 'square' ? '#vid-square' : '#vid-story');
      await p.waitForTimeout(3000);
      midShots.push(await shot(`video-${fmt}-recording`));
      check(await p.locator('#dl-pdf').isDisabled(), 'other exports are disabled while the video records', 'page');
    }, 240000);
    R.timings[`video-${fmt}-ms`] = Date.now() - t0;
    const ff = ffprobe(f); R.files[`video-${fmt}`].ffprobe = ff;
    check(new RegExp(`^squiggle-1234-frame-large-${fmt === 'story' ? '9x16' : 'square'}\\.(mp4|webm)$`).test(path.basename(f)), `${fmt} video file name`, 'exports', path.basename(f));
    const k = mobile ? 2 / 3 : 1, W = Math.round(1080 * k), H = Math.round((fmt === 'story' ? 1920 : 1080) * k);
    check(ff.duration >= 15 && ff.duration <= 30, `${fmt} video lasts 15–30 s`, 'motion', `${ff.duration?.toFixed?.(2)} s`);
    check(ff.video && ff.video.width === W && ff.video.height === H, `${fmt} video is ${W} × ${H}`, 'motion', JSON.stringify(ff.video));
    check(!!ff.audio, `${fmt} video has an audio track`, 'motion', JSON.stringify(ff.audio ?? null));
    // play it back in the page: duration, frames, sound
    const rel = path.relative(process.cwd(), f);
    const pb = await p.evaluate(async url => {
      const bytes = await (await fetch(url)).arrayBuffer();
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.src = URL.createObjectURL(new Blob([bytes], { type: url.endsWith('.webm') ? 'video/webm' : 'video/mp4' })); v.style.cssText = 'position:fixed;left:-4000px;top:0;width:320px';
      document.body.append(v);
      await new Promise((ok, ko) => { v.onloadedmetadata = ok; v.onerror = () => ko(new Error('video error ' + v.error?.code)); setTimeout(() => ko(new Error('metadata timeout')), 15000); });
      if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise(r => { v.ondurationchange = r; setTimeout(r, 3000); }); v.currentTime = 0; }
      const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
      await v.play(); await new Promise(r => setTimeout(r, 1500));
      out.playedTo = v.currentTime; out.frames = v.webkitDecodedFrameCount; out.audioBytes = v.webkitAudioDecodedByteCount;
      v.pause();
      // a strip of frames: 1 s, 25 %, 50 %, 70 %, 85 %, the end
      const at = [1, 0.25, 0.5, 0.7, 0.85].map((f, i) => (i ? f * out.duration : f)).concat(out.duration - 0.3);
      const cw = 300, ch = Math.round(cw * out.h / out.w), c = document.createElement('canvas'); c.width = cw * 3; c.height = ch * 2;
      const x = c.getContext('2d');
      for (let i = 0; i < at.length; i++) {
        v.currentTime = at[i]; await new Promise(r => { v.onseeked = r; setTimeout(r, 3000); });
        x.drawImage(v, (i % 3) * cw, Math.floor(i / 3) * ch, cw, ch);
      }
      out.sheet = c.toDataURL('image/jpeg', 0.85);
      // the soundtrack: decoded, loud enough, with clicks
      try {
        const ac = new OfflineAudioContext(1, 44100, 44100);
        const a = await ac.decodeAudioData(bytes.slice(0)), d = a.getChannelData(0);
        let peak = 0, sum = 0, clicks = 0, last = -1e9;
        for (let i = 0; i < d.length; i++) { const s = Math.abs(d[i]); peak = Math.max(peak, s); sum += s * s; if (s > 0.2 && i - last > a.sampleRate * 0.03) { clicks++; last = i; } }
        Object.assign(out, { audioSeconds: a.duration, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), clicks });
      } catch (e) { out.audioError = String(e.message || e); }
      v.remove();
      return out;
    }, '/__qa/' + encodeURIComponent(rel));
    fs.writeFileSync(path.join(dir, `${String(++n).padStart(2, '0')}-video-${fmt}-frames.jpg`), Buffer.from(pb.sheet.split(',')[1], 'base64'));
    delete pb.sheet; R.files[`video-${fmt}`].playback = pb;
    check(pb.playedTo > 0.8 && pb.frames > 10, `${fmt} video plays in the page`, 'motion', JSON.stringify(pb));
    check(pb.duration >= 15 && pb.duration <= 30, `${fmt} video duration in the page 15–30 s`, 'motion', pb.duration);
    check((pb.audioBytes > 0 || pb.audioSeconds > 10) && pb.peak > 0.05 && pb.clicks > 20, `${fmt} video soundtrack is audible, with brick clicks`, 'motion', JSON.stringify({ audioBytes: pb.audioBytes, audioSeconds: pb.audioSeconds, peak: pb.peak, rms: pb.rms, clicks: pb.clicks, err: pb.audioError }));
    await p.waitForTimeout(500);
    check(await p.locator('#dl-pdf').isEnabled(), 'exports are enabled again after the video', 'page');
  });

  // ---- 9. the order flow ----
  let pabBytes = null;
  await step('order-flow', async () => {
    await press('#secnav a[data-sec=sec-buy]');
    await p.waitForTimeout(1200);
    await shot('buy-section');
    const sub = await text('#subtot');
    check(/Squiggle/.test(sub) && /Display/.test(sub) && /Total/.test(sub), 'shopping list shows Squiggle / Display / Total subtotals', 'page', sub.replace(/\n/g, ' | '));
    const s = await st();
    const legoN = +(await text('#lego-n'));
    check(exp && legoN === exp.legoLots, `Buy at LEGO shows ${exp?.legoLots} lots`, 'page', legoN);
    // the dialog blocks: cancel → nothing downloads
    let dls = 0; const onDl = () => dls++; p.on('download', onDl);
    // Buy on BrickLink first: the notice guards it too, and nothing is copied until "I understand"
    await p.evaluate(() => navigator.clipboard.writeText('qa-sentinel')).catch(() => {});
    await press('#buy-bl');
    await p.waitForTimeout(500);
    check(await p.locator('#before-order').isVisible(), '"Before you order" also opens on Buy on BrickLink', 'page');
    await press('#before-order button.ghost');
    await p.waitForTimeout(400);
    const clip0 = await p.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERR ' + e.message);
    check(clip0 === 'qa-sentinel' && await p.locator('#bl-after').isHidden() && dls === 0, 'BrickLink → Cancel: nothing copied, nothing downloaded', 'page', `clipboard ${JSON.stringify(clip0.slice(0, 40))}, downloads ${dls}`);
    {   // the "Files" links under "How ordering works" are guarded too
      await press('details.howorder summary'); await p.waitForTimeout(300);
      await press('#dl-xml'); await p.waitForTimeout(500);
      check(await p.locator('#before-order').isVisible(), '"BrickLink list (XML)" link opens the notice first', 'page');
      await p.keyboard.press('Escape'); await p.waitForTimeout(400);
      check(dls === 0, 'XML link → Escape: no download', 'page', `downloads ${dls}`);
      await press('#dl-pab'); await p.waitForTimeout(500);
      check(await p.locator('#before-order').isVisible(), '"LEGO list (CSV)" link opens the notice first', 'page');
      await press('#before-order button.ghost'); await p.waitForTimeout(400);
      check(dls === 0, 'LEGO list link → Cancel: no download', 'page', `downloads ${dls}`);
      // the plain parts list is not an order file: record what it does before "I understand"
      const csvDl = p.waitForEvent('download', { timeout: 2500 }).then(() => true, () => false);
      await press('#dl-csv');
      R.partsCsvUnguarded = { downloaded: await csvDl, dialog: await p.locator('#before-order').isVisible() };
      if (R.partsCsvUnguarded.dialog) await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      dls = 0;
      await press('details.howorder summary'); await p.waitForTimeout(300);
    }
    await press('#buy-lego');
    await p.waitForTimeout(500);
    check(await p.locator('#before-order').isVisible(), '"Before you order" opens on Buy at LEGO', 'page');
    check(await p.locator('#bo-continue').isDisabled(), '"Continue" is disabled until "I understand" is ticked', 'page');
    await shot('before-you-order');
    const punkHtml = path.join(__dirname, '../../punk-to-bricks/index.html');   // "stays exactly as in Punk to Bricks"
    if (fs.existsSync(punkHtml)) {
      const punk = (fs.readFileSync(punkHtml, 'utf8').match(/<dialog id="before-order"[\s\S]*?<\/dialog>/) || [])[0];
      const ours = await p.evaluate(() => document.getElementById('before-order').innerText.replace(/\s+/g, ' ').trim());
      const theirs = await p.evaluate(h => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px'; d.innerHTML = h.replace(/<dialog/, '<div').replace(/<\/dialog>/, '</div>'); document.body.append(d); const t = d.innerText.replace(/\s+/g, ' ').trim(); d.remove(); return t; }, punk || '');
      check(ours === theirs, '"Before you order" reads exactly as in Punk to Bricks', 'page', ours === theirs ? '' : `ours: ${ours.slice(0, 200)} | punk: ${theirs.slice(0, 200)}`);
    }
    await taps('before you order');
    await overflow('before you order');
    const dlg = await p.locator('#before-order').boundingBox(), vp = p.viewportSize();
    check(dlg && dlg.y >= 0 && dlg.x >= 0 && dlg.x + dlg.width <= vp.width + 1, 'the dialog fits the screen width', 'page', JSON.stringify(dlg));
    await p.locator('#bo-continue').click({ force: true, timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(400);
    check(await p.locator('#before-order').isVisible() && dls === 0, 'clicking the disabled Continue does nothing', 'page', `downloads ${dls}`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    check(await p.locator('#before-order').isHidden() && dls === 0 && await p.locator('#lego-guide').isHidden(), 'Escape closes it: no download, no guide', 'page', `downloads ${dls}`);
    await press('#buy-lego');
    await p.waitForTimeout(400);
    await press('#before-order button.ghost');
    await p.waitForTimeout(400);
    check(await p.locator('#before-order').isHidden() && dls === 0, 'Cancel closes it: no download', 'page', `downloads ${dls}`);
    p.off('download', onDl);
    // tick, continue → the Pick a Brick file and the guide
    await press('#buy-lego');
    await p.waitForTimeout(400);
    await press('#bo-ok');
    check(await p.locator('#bo-continue').isEnabled(), '"I understand" enables Continue', 'page');
    const f = await download('pab', () => press('#bo-continue'));
    pabBytes = fs.readFileSync(f);
    check(path.basename(f) === 'squiggle-1234-frame-large-pick-a-brick.csv', 'Pick a Brick file name', 'exports', path.basename(f));
    const pc = pabCheck(pabBytes, exp?.pab); R.files.pab.check = pc;
    check(!pc.errs.length, 'Pick a Brick CSV: header elementId,quantity, CRLF, no trailing newline, digits, sums = LEGO lots', 'exports', pc.errs.join('; ') || `${pc.lines} lines, ${pc.pieces} pieces`);
    check(pc.pieces === s.pieces, 'Pick a Brick CSV has every piece', 'exports', `${pc.pieces} vs ${s.pieces}`);
    await p.waitForTimeout(1200);
    check(await p.locator('#lego-guide').isVisible(), 'the "Buy at LEGO in 3 steps" guide appears', 'page');
    await p.locator('#lego-guide figure').scrollIntoViewIfNeeded();
    const imgs = await idle(() => [...document.querySelectorAll('#lego-guide img')].every(i => i.complete && i.naturalWidth > 0), null, 15000).then(() => true, () => false);
    check(imgs, 'the guide shows both Pick a Brick screenshots', 'page', await p.evaluate(() => [...document.querySelectorAll('#lego-guide img')].map(i => `${i.getAttribute('src')} ${i.naturalWidth}`).join(', ')));
    const fileLine = await text('#lego-file');
    check(fileLine.includes('squiggle-1234-frame-large-pick-a-brick.csv'), 'the guide names the downloaded file', 'page', fileLine);
    await shot('lego-guide', { el: '#lego-guide' });
    const pabLink = await p.locator('#lego-guide a.go-lego').getAttribute('href');
    check(pabLink === 'https://www.lego.com/pick-and-build/pick-a-brick', 'guide links to Pick a Brick', 'page', pabLink);
    // download again: no dialog the second time
    const f2 = await download('pab-again', () => press('#lego-again'));
    check(fs.readFileSync(f2).equals(pabBytes) && await p.locator('#before-order').isHidden(), '"Download it again" gives the same bytes without asking again', 'exports', path.basename(f2));
    await taps('lego guide');
    // BrickLink: copy
    await press('#buy-bl');
    await p.waitForTimeout(800);
    check(await p.locator('#bl-after').isVisible(), 'Buy on BrickLink: the "List copied" line appears', 'page', await text('#bl-after'));
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERR ' + e.message);
    R.files.clipboard = { bytes: clip.length };
    const xc = xmlCheck(clip, exp?.bl); R.files.clipboard.check = xc;
    check(!xc.errs.length && xc.pieces === s.pieces, 'the copied BrickLink XML is valid, every lot, every piece', 'exports', xc.errs.join('; ') || `${xc.items} items, ${xc.pieces} pieces`);
    const blText = await text('#bl-after');
    check(new RegExp(`all ${s.lots} lots`).test(blText), 'the copied line counts all lots', 'page', blText);
    const blLink = await p.locator('#bl-after a').getAttribute('href');
    check(blLink === 'https://www.bricklink.com/v2/wanted/upload.page', 'BrickLink upload link', 'page', blLink);
    await shot('bricklink-copied', { el: '.ctas' });
    // the files under "How ordering works"
    await press('details.howorder summary');
    await p.waitForTimeout(400);
    await shot('how-ordering', { el: 'details.howorder' });
    const fx = await download('xml', () => press('#dl-xml'));
    const xml = fs.readFileSync(fx, 'utf8');
    check(xml === clip, 'the XML file is the copied list', 'exports', `${xml.length} vs ${clip.length} bytes`);
    const fc = await download('csv', () => press('#dl-csv'));
    const pc2 = partsCsvCheck(fs.readFileSync(fc, 'utf8'), exp);
    check(!pc2.errs.length, 'parts CSV: header, one row per lot, TOTAL = pieces, both sections', 'exports', pc2.errs.join('; '));
    const fp = await download('pab-link', () => press('#dl-pab'));
    check(fs.readFileSync(fp).equals(pabBytes), 'the "LEGO list (CSV)" link gives the same file', 'exports', path.basename(fp));
    const kitPab = path.join(files, 'kit', 'squiggle-1234-frame-large-pick-a-brick.csv');
    if (fs.existsSync(kitPab)) check(fs.readFileSync(kitPab).equals(pabBytes), 'the kit’s Pick a Brick file is the same bytes', 'exports');
    await press('#shop-more');
    await p.waitForTimeout(400);
    const lots = await p.locator('#shop-grid .lot:visible').count();
    check(lots === s.lots, 'See all lots shows every lot', 'page', `${lots} of ${s.lots}`);
    await shot('shopping-list-all', { el: '#shoplist' });
    const cut = await p.evaluate(() => [...document.querySelectorAll('#shop-grid .lot small')].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => `"${s.textContent}" (${s.closest('.lot').title.split(' · ')[0]})`));
    R.cutLotNames = cut;
    check(!cut.length, 'the shopping list shows every part name in full (no name cut with …)', 'page', `${cut.length} cut: ${cut.slice(0, 6).join('; ')}`);
    await press('#shop-more');
    await overflow('buy'); await taps('buy');
  });

  // ---- 10. Share on X ----
  await step('share-x', async () => {
    const s = await st();
    const a = p.locator('#share-x');
    await a.scrollIntoViewIfNeeded();
    await a.dispatchEvent('pointerdown');
    const href = await a.getAttribute('href');
    const u = new URL(href), t = u.searchParams.get('text') ?? '', link = u.searchParams.get('url');
    R.shareX = { href, text: t, url: link };
    check(u.host === 'x.com' && u.pathname === '/intent/post', 'Share on X opens x.com/intent/post', 'page', href.slice(0, 80));
    check(t.includes('Chromie Squiggle #1234') && t.includes(s.pieces.toLocaleString('en')) && /Frame/.test(t), 'the post names #1234, its pieces and the Frame', 'page', t);
    check(t.includes("@victormustar") && !/\bLEGO\b/.test(t), 'the post credits @victormustar and never says LEGO', 'page', t);
    check(link === new URL(BASE).origin + '/?id=1234', 'the post links back to ?id=1234', 'page', link);
    check(await a.getAttribute('target') === '_blank' && /noopener/.test(await a.getAttribute('rel')), 'opens in a new tab, noopener', 'page');
  });

  // ---- 11. an example chip, then a second Squiggle typed: state reset ----
  await step('second-squiggle', async () => {
    // "10000" pasted then Build, with #1234 on screen
    await p.locator('#input-panel').scrollIntoViewIfNeeded();
    await p.locator('#sq-number').fill('10000');
    const shownVal = await p.locator('#sq-number').inputValue();
    await press('#by-number button.go');
    await p.waitForTimeout(1200);
    const r10k = { field: shownVal, error: await p.locator('#error').isVisible() ? await text('#error-text') : null, loading: await p.evaluate(() => window.stb.loaded?.id), url: p.url() };
    R.tenThousand.pastedBuild = r10k;
    check(r10k.error && r10k.loading === 1234 && /id=1234\b/.test(r10k.url), '"10000" pasted + Build with #1234 shown → an error, #1234 stays', 'page', JSON.stringify(r10k));
    await shot('pasted-10000-build');
    await idle(() => document.getElementById('busy').hidden && window.stb.model, null, 120000).catch(() => {});
    if (r10k.url.includes('id=1000')) {   // it built #1000: back to #1234 before going on
      await p.locator('#sq-number').fill('1234'); await press('#by-number button.go');
      await idle(() => window.stb.loaded?.id === 1234 && document.getElementById('busy').hidden && window.stb.model, null, 120000);
    }
    // leave a non-default choice first (Backdrop · Small), then pick #7583
    await press('.disp[data-display=backdrop]'); await shown(['relief', 'backdrop', 'large']);
    await press('[data-scale=small]'); await shown(['relief', 'backdrop', 'small']);
    const prev = await st();
    const prevOrig = await p.locator('#orig-img').getAttribute('src');
    await idle(() => [...document.querySelectorAll('.disp .dfig')].every(d => /pieces/.test(d.textContent)), null, 90000).catch(() => {});
    const prevFigs = await p.evaluate(() => [...document.querySelectorAll('.disp .dfig')].map(d => d.textContent));
    const tc = sel => p.evaluate(q => document.querySelector(q).textContent, sel);   // inside the closed "More info"
    const prevNotes = await tc('#notes'), prevRead = await tc('#read-text');
    await p.locator('#input-panel').scrollIntoViewIfNeeded();
    await press('#examples button >> nth=1');
    await p.waitForTimeout(400);
    await shot('example-7583-loading');
    await idle(() => window.stb.loaded?.id === 7583 && document.getElementById('busy').hidden && window.stb.model, null, 120000);
    await p.waitForTimeout(600);
    const s = await st();
    R.second = s;
    check(s.id === 7583, 'the #7583 chip builds #7583', 'page', JSON.stringify(s));
    check(/[?&]id=7583\b/.test(p.url()), 'URL becomes ?id=7583', 'page', p.url());
    check(s.display === 'backdrop' && s.scale === 'small', 'the chosen display and size are kept for the next Squiggle', 'page', JSON.stringify(s));
    const radios = await p.evaluate(() => [...document.querySelectorAll('[role=radio][aria-checked=true]')].map(b => b.dataset.format || b.dataset.display || b.dataset.scale));
    check(radios.includes(s.display) && radios.includes(s.scale), 'the picker shows the model that is on screen', 'page', radios.join(','));
    check(await text('#orig-title') === 'Chromie Squiggle #7583' && await p.locator('#orig-img').getAttribute('src') !== prevOrig, 'the original is replaced by #7583', 'page', await text('#orig-title'));
    const stats = await text('#stats');
    check(stats.includes(s.pieces.toLocaleString('en')), 'figures are those of #7583', 'page', stats.replace(/\n/g, ' '));
    check(await p.locator('#lego-guide').isHidden() && await p.locator('#bl-after').isHidden(), 'the LEGO guide and "List copied" of #1234 are gone', 'page');
    check(await p.locator('#error').isHidden(), 'the "10000" error is gone once #7583 builds', 'page', await text('#error-text'));
    const notes = await tc('#notes'), read = await tc('#read-text');
    check(read !== prevRead && /Perfect spectrum/i.test(read), 'More info "What we read" describes #7583', 'page', read.slice(0, 160));
    check(notes !== prevNotes && /Computed in your browser/.test(notes), 'More info notes are recomputed', 'page', `${prevNotes.slice(0, 120)} → ${notes.slice(0, 120)}`);
    const lotsShown = await p.locator('#shop-grid .lot').count(), shopSum = await text('#shop-sum');
    check(lotsShown === s.lots && shopSum.startsWith(`${s.lots} lots`), 'the shopping list is #7583’s', 'page', `${lotsShown} lot cards, "${shopSum}", model ${s.lots} lots`);
    check(await p.locator('#thumbs button').count() === s.pages, 'the reader strip has #7583’s pages', 'booklet', `${await p.locator('#thumbs button').count()} vs ${s.pages}`);
    check((await text('#model-sub')).includes('#7583'), 'the section title names #7583', 'page', await text('#model-sub'));
    const feats = await p.evaluate(() => [...document.querySelectorAll('#features div')].map(d => d.textContent).join(' · '));
    check(/Perfect Spectrum|Spectrum/i.test(feats), '#7583 features shown', 'page', feats);
    await idle(() => [...document.querySelectorAll('.disp .dfig')].every(d => /pieces/.test(d.textContent)), null, 90000).catch(() => {});
    const figs = await p.evaluate(() => [...document.querySelectorAll('.disp .dfig')].map(d => d.textContent));
    check(figs.every((f, i) => f !== prevFigs[i]) && figs.some(f => f.includes(s.pieces.toLocaleString('en'))), 'display thumbnails show #7583 figures', 'page', `${prevFigs.join(' / ')} → ${figs.join(' / ')}`);
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await p.waitForTimeout(1500);
    await shot('example-7583');
    await p.locator('#sec-manual').scrollIntoViewIfNeeded();
    await p.waitForTimeout(2500);
    check((await text('#pg-label')).trim() === 'Cover' && (await text('#manual-sub')).includes(`${s.steps} steps`), 'the reader restarts on the Cover of #7583', 'booklet', `${await text('#pg-label')} · ${await text('#manual-sub')}`);
    await shot('example-7583-reader', { el: '.reader' });
    // share link follows
    await p.locator('#share-x').dispatchEvent('pointerdown');
    const t = new URL(await p.locator('#share-x').getAttribute('href')).searchParams.get('text');
    check(t.includes('#7583') && t.includes(s.pieces.toLocaleString('en')) && /Backdrop/.test(t), 'Share on X text follows #7583 Backdrop', 'page', t);
    // the order notice was accepted once for the visit
    const f = await download('pab-7583', async () => { await p.locator('#sec-buy').scrollIntoViewIfNeeded(); await press('#buy-lego'); });
    check(path.basename(f) === 'squiggle-7583-backdrop-small-pick-a-brick.csv', 'Buy at LEGO for #7583 downloads its own list (no second notice)', 'exports', path.basename(f));
    const e2 = await expected();
    const pc = pabCheck(fs.readFileSync(f), e2.pab);
    check(!pc.errs.length, '#7583 Backdrop Small Pick a Brick CSV exact', 'exports', pc.errs.join('; '));
    // then a number typed by hand, and a quick change of mind (two chips in a row)
    await p.locator('#input-panel').scrollIntoViewIfNeeded();
    await p.locator('#sq-number').fill('');
    await press('#sq-number'); await p.keyboard.type('102');
    const pushes0 = await p.evaluate(() => window.__nav.stack.length);
    await p.keyboard.press('Enter');   // Build #102 with the Enter key…
    await p.waitForTimeout(80);
    await p.locator('#examples button >> nth=4').dispatchEvent('click');   // …and #1000 Slinky while #102 is still loading
    await idle(() => window.stb.loaded?.id === 1000 && document.getElementById('busy').hidden && window.stb.model, null, 120000);
    await p.waitForTimeout(3000);
    const s3 = await st(), pushed = (await p.evaluate(() => window.__nav.stack)).slice(pushes0).map(u => new URL(u).searchParams.get('id'));
    R.race = { pushed, field: await p.locator('#sq-number').inputValue() };
    check(s3.id === 1000 && await text('#orig-title') === 'Chromie Squiggle #1000' && /[?&]id=1000\b/.test(p.url()) && R.race.field === '1000' && (await text('#stats')).startsWith(s3.pieces.toLocaleString('en')), 'Enter on #102 then the #1000 chip at once ends on #1000 everywhere (URL, original, field, figures)', 'page', `${JSON.stringify(s3)} · ${await text('#orig-title')} · ${p.url()} · pushed ${pushed}`);
    check(!pushed.includes('102'), 'the dropped #102 leaves no history entry', 'page', `pushed ${pushed.join(', ')}`);
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await shot('slinky-1000');
    // #102 on its own
    await p.locator('#input-panel').scrollIntoViewIfNeeded();
    await p.locator('#sq-number').fill(''); await press('#sq-number'); await p.keyboard.type('102');
    await press('#by-number button.go');
    await idle(() => window.stb.loaded?.id === 102 && document.getElementById('busy').hidden && window.stb.model, null, 120000);
    await p.waitForTimeout(2000);
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await shot('bold-102');
    const s4 = await st();
    check(s4.id === 102 && (await text('#stats')).includes(s4.pieces.toLocaleString('en')), '#102 Bold built and shown', 'page', JSON.stringify(s4));
    await overflow('second squiggle'); await taps('second squiggle');
  });

  // ---- 12. back / forward / reload ----
  await step('history', async () => {
    const len = await p.evaluate(() => history.length);
    R.history = { length: len, url: p.url(), walk: [] };
    // Squiggles shown in this visit, newest first: 102, 1000, 7583, 1234, then the landing page
    const settle = () => idle(() => { const x = window.stb, id = new URLSearchParams(location.search).get('id'); return id === null ? document.getElementById('result').hidden || (x.loaded && x.loaded.id === null) : x?.loaded?.id === +id && x.model && document.getElementById('busy').hidden; }, null, 60000).then(() => true, () => false);
    const coherent = async (what, want) => {
      const ok = await settle();
      await p.waitForTimeout(700);
      const r = await p.evaluate(() => ({ url: location.href.replace(location.origin, ''), urlId: new URLSearchParams(location.search).get('id'), shown: window.stb?.loaded?.id ?? null, title: document.getElementById('orig-title')?.textContent, field: document.getElementById('sq-number').value, result: !document.getElementById('result').hidden, busy: !document.getElementById('busy').hidden, stats: document.getElementById('stats').innerText.split('\n')[0], pieces: window.stb?.model?.pieces.length ?? null }));
      R.history.walk.push({ what, want, settled: ok, ...r });
      if (want === null) check(!r.result && r.urlId === null && r.field === '', `${what}: back on the landing page (no result, empty field)`, 'page', JSON.stringify(r));
      else check(ok && r.urlId === String(want) && r.shown === want && r.title === `Chromie Squiggle #${want}` && r.field === String(want) && r.stats === (r.pieces ?? 0).toLocaleString('en'), `${what}: URL, original, field and figures all show #${want}`, 'page', JSON.stringify(r));
      await p.locator(want === null ? 'body' : '#sec-model').scrollIntoViewIfNeeded().catch(() => {});
      await shot(`history-${what}`);
      return r;
    };
    const nav = await p.evaluate(() => window.__nav);
    const idOf = u => { const v = new URL(u).searchParams.get('id'); return v === null ? null : +v; }, stack = nav.stack.map(idOf);
    R.history.stack = stack;
    log(`history as pushed: ${stack.map(v => v ?? 'landing').join(' → ')} (at ${nav.i})`);
    check(stack[0] === null && stack.slice(1).every(v => v !== null) && stack.at(-1) === 102 && stack.includes(1234) && stack.includes(7583) && stack.includes(1000), 'one history entry per Squiggle shown, the landing page first', 'page', stack.join(','));
    for (let i = nav.i - 1, k = 1; i >= 0; i--, k++) { await p.goBack({ waitUntil: 'commit' }).catch(() => null); await coherent(`back${k}`, stack[i]); }
    for (let i = 1; i <= 2; i++) { await p.goForward({ waitUntil: 'commit' }).catch(() => null); await coherent(`forward${i}`, stack[i]); }
    // two quick Forwards (the first load is still running when the second comes): it ends on the second, coherent
    await p.goForward({ waitUntil: 'commit' }).catch(() => null); await p.waitForTimeout(150); await p.goForward({ waitUntil: 'commit' }).catch(() => null);
    await coherent('fast-forward-x2', stack[4] ?? stack.at(-1));
    log(`history walk: ${R.history.walk.map(w => `${w.what}→${w.urlId}/${w.shown}`).join(', ')}`);
    R.history.forwardState = await st().catch(() => null);
    // reload on ?id=102: rebuilt, default display
    await p.goto(new URL('/?id=102', BASE).href, { waitUntil: 'load' });
    const t0 = Date.now();
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    R.timings.reloadToModel = Date.now() - t0;
    const s = await st();
    check(s.id === 102 && s.display === 'frame' && s.scale === 'large' && await p.locator('#sq-number').inputValue() === '102', 'reload of ?id=102 rebuilds #102 as the Large Frame, number in the field', 'page', JSON.stringify(s));
    await p.waitForTimeout(1500);
    await shot('reload-102');
    await p.reload({ waitUntil: 'load' });
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    check((await st()).id === 102, 'a second reload rebuilds it again', 'page');
    // a link with a section hash
    await p.goto(new URL('/?id=1234#sec-buy', BASE).href, { waitUntil: 'load' });
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    await p.waitForTimeout(1500);
    const where = await p.evaluate(() => ({ buyTop: Math.round(document.getElementById('sec-buy').getBoundingClientRect().top), modelTop: Math.round(document.getElementById('sec-model').getBoundingClientRect().top) }));
    R.history.hashLink = where;
    await shot('link-with-hash');
    // bad ids in the URL
    for (const bad of ['abc', '10000', '-1', '']) {
      await p.goto(new URL(`/?id=${bad}`, BASE).href, { waitUntil: 'load' });
      await p.waitForTimeout(1500);
      const r = { result: await p.locator('#result').isVisible(), error: await p.locator('#error').isVisible() ? await text('#error-text') : null };
      check(!r.result, `?id=${bad} builds nothing`, 'page', JSON.stringify(r));
      R.history[`bad-${bad}`] = r;
    }
  });

  // ---- 13. fallbacks and upload (desktop) ----
  if (!mobile && !flag('no-extras')) await step('fallbacks', async () => {
    for (const [fail, origin] of [['generator', 'port'], ['token,generator', 'image']]) {
      await p.goto(new URL(`/?id=3784&fail=${fail}`, BASE).href, { waitUntil: 'load' });
      await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
      await p.waitForTimeout(2500);
      const s = await st();
      check(s.origin === origin && s.id === 3784, `?fail=${fail} → origin ${origin}`, 'load', JSON.stringify(s));
      const o = await text('#orig-origin');
      check(origin === 'port' ? /hash/.test(o) : /approximate/.test(o), `the page says how #3784 was read (${origin})`, 'page', o);
      check(await p.evaluate(() => { const i = document.getElementById('orig-img'); return i.naturalWidth > 0; }), `original shown (${origin})`, 'load');
      await p.locator('#sec-model').scrollIntoViewIfNeeded();
      await shot(`fallback-${origin}`);
    }
    await p.goto(new URL('/?id=3784&fail=token,generator,port,image', BASE).href, { waitUntil: 'load' });
    await idle(() => !document.getElementById('error').hidden, null, 60000);
    const err = await text('#error-text');
    check(/upload/i.test(err) && await p.locator('#error-upload').isVisible(), 'everything failing → message + "Upload an image"', 'load', err);
    await shot('fallback-error');
    // upload: the #1234 original drawn by its own script, saved from the page earlier
    const png = path.join(files, 'upload-1234.png');
    await p.goto(new URL('/?id=1234', BASE).href, { waitUntil: 'load' });
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    const du = await p.evaluate(() => window.stb.loaded.original);
    fs.writeFileSync(png, Buffer.from(du.split(',')[1], 'base64'));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.locator('#file').setInputFiles(png);
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    await p.waitForTimeout(2500);
    const s = await st();
    check(s.origin === 'upload' && s.id === null, 'upload → a model traced from the picture', 'load', JSON.stringify(s));
    check(!/[?&]id=/.test(p.url()) && /My Chromie Squiggle|Chromie Squiggle/.test(await text('#orig-title')), 'upload: no ?id, a neutral title', 'page', `${p.url()} · ${await text('#orig-title')}`);
    await p.locator('#sec-model').scrollIntoViewIfNeeded();
    await shot('upload');
    // a non-image upload
    const txt = path.join(files, 'not-an-image.txt'); fs.writeFileSync(txt, 'hello');
    await p.locator('#input-panel').scrollIntoViewIfNeeded();
    await p.locator('#file').setInputFiles(txt);
    await p.waitForTimeout(1500);
    const e2 = await p.locator('#error').isVisible() ? await text('#error-text') : null;
    check(!!e2, 'a text file as upload → a clear error', 'load', String(e2));
    await shot('upload-not-image');
  });

  // ---- 14. more: edge numbers, quick changes of mind, the other models' files, a video while switching ----
  const open = async (q) => {
    await p.goto(new URL(q, BASE).href, { waitUntil: 'load' });
    await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000);
    await p.waitForTimeout(500);
  };
  const orderDl = async (name, sel) => download(name, async () => {
    await press(sel); await p.waitForTimeout(400);
    if (await p.locator('#before-order').isVisible()) { await press('#bo-ok'); await press('#bo-continue'); }
  });
  /** the reader page whose label starts with `label` */
  const readerPage = async (label, shotName) => {
    await p.locator('#sec-manual').scrollIntoViewIfNeeded();
    await idle(() => window.stb.maker && document.querySelectorAll('#thumbs button').length === window.stb.maker.total, null, 30000);
    const i = await p.evaluate(l => [...document.querySelectorAll('#thumbs button')].findIndex(b => b.textContent.trim() === l || b.textContent.startsWith(l)), label);
    if (i < 0) return false;
    await press(p.locator('#thumbs button').nth(i)); await p.waitForTimeout(2000);
    await shot(shotName, { el: '#page-view' });
    return true;
  };
  const exportsOf = async (tag) => {   // every file of the model on screen, checked
    const s = await st(), e = await expected(), base = await p.evaluate(() => { const m = window.stb.model, l = window.stb.loaded; return `squiggle-${l.id ?? 'upload'}-${m.format === 'mosaic' ? 'mosaic' : m.display}-${m.scale}`; });
    const f = await download(`${tag}-pdf`, () => press('#dl-pdf'), 180000), i = pdfInfo(f);
    check(path.basename(f) === `${base}-instructions.pdf` && i.header.startsWith('%PDF-') && i.eof && i.pages === s.pages && i.count === s.pages, `${tag}: PDF ${path.basename(f)} opens, ${s.pages} pages like the reader`, 'booklet', JSON.stringify(i));
    const jp = pdfJpegs(f);
    for (const k of [0, 1, jp.length - 3, jp.length - 2, jp.length - 1]) if (jp[k]) fs.writeFileSync(path.join(files, `${tag}-pdf-page-${k + 1}.jpg`), jp[k]);
    const kf = await download(`${tag}-kit`, () => press('#dl-kit'), 240000), list = unzipList(kf).map(x => x.name);
    const want = [`${base}-instructions.pdf`, `${base}-parts.csv`, `${base}-pick-a-brick.csv`, `${base}-bricklink.xml`, `${base}-nameplate.png`, `${base}-nameplate-cut-marks.png`, `${base}-share.png`, 'README.txt'];
    check(want.every(w => list.includes(w)), `${tag}: the kit has every file`, 'exports', list.join(', '));
    const x = path.join(files, `${tag}-kit`); fs.rmSync(x, { recursive: true, force: true }); sh('unzip', ['-q', '-o', kf, '-d', x]);
    const readme = fs.readFileSync(path.join(x, 'README.txt'), 'utf8');
    R.files[`${tag}-readme`] = readme.split(/\r?\n/).slice(0, 5);
    check(readme.includes(`${s.pieces.toLocaleString('en')} pieces`) && (s.display === 'frame' ? /HANGING/.test(readme) : !/HANGING THE FRAME/.test(readme)), `${tag}: README names its pieces${s.display === 'frame' ? ' and how to hang it' : ', no hanging section'}`, 'exports', readme.slice(0, 300));
    const pab = pabCheck(fs.readFileSync(path.join(x, `${base}-pick-a-brick.csv`)), e.pab);
    check(!pab.errs.length && pab.pieces === s.pieces, `${tag}: kit Pick a Brick CSV exact (${pab.lines} lines, ${pab.pieces} pieces)`, 'exports', pab.errs.join('; '));
    const xml = xmlCheck(fs.readFileSync(path.join(x, `${base}-bricklink.xml`), 'utf8'), e.bl);
    check(!xml.errs.length, `${tag}: kit BrickLink XML valid, every lot`, 'exports', xml.errs.join('; '));
    const csv = partsCsvCheck(fs.readFileSync(path.join(x, `${base}-parts.csv`), 'utf8'), e);
    check(!csv.errs.length, `${tag}: kit parts CSV complete`, 'exports', csv.errs.join('; '));
    const sh2 = pngInfo(path.join(x, `${base}-share.png`)), np = pngInfo(path.join(x, `${base}-nameplate.png`));
    check(sh2?.w === 1200 && sh2?.h === 630 && np?.dpi === 600, `${tag}: share image 1200 × 630, nameplate 600 dpi`, 'exports', JSON.stringify({ sh2, np }));
    fs.copyFileSync(path.join(x, `${base}-share.png`), path.join(dir, `${String(++n).padStart(2, '0')}-${tag}-share.png`));
    fs.copyFileSync(path.join(x, `${base}-nameplate.png`), path.join(dir, `${String(++n).padStart(2, '0')}-${tag}-nameplate.png`));
    const pf = await orderDl(`${tag}-pab`, '#buy-lego'), pc = pabCheck(fs.readFileSync(pf), e.pab);
    check(path.basename(pf) === `${base}-pick-a-brick.csv` && !pc.errs.length, `${tag}: Buy at LEGO → ${path.basename(pf)} exact`, 'exports', pc.errs.join('; '));
    return { s, base };
  };
  if (!mobile && !flag('no-extras')) {
    await step('edge-numbers', async () => {
      await open('/?id=0');
      let s = await st();
      check(s.id === 0 && await text('#orig-title') === 'Chromie Squiggle #0', '?id=0 builds Squiggle #0', 'load', JSON.stringify(s));
      await p.locator('#sec-model').scrollIntoViewIfNeeded(); await shot('squiggle-0');
      for (const [typed, want] of [['9999', 9999], [' 01234 ', 1234], ['#7583', 7583]]) {
        await p.locator('#input-panel').scrollIntoViewIfNeeded();
        await p.locator('#sq-number').fill(''); await press('#sq-number'); await p.keyboard.type(typed);
        await p.keyboard.press('Enter');
        const ok = await idle(w => window.stb.loaded?.id === w && window.stb.model && document.getElementById('busy').hidden, want, 120000).then(() => true, () => false);
        s = await st();
        check(ok && s.id === want && new URL(p.url()).searchParams.get('id') === String(want) && await p.locator('#sq-number').inputValue() === String(want), `typing "${typed}" + Enter builds #${want} (URL, field)`, 'page', `${JSON.stringify(s)} · ${p.url()} · field "${await p.locator('#sq-number').inputValue()}"`);
      }
      await p.locator('#sec-model').scrollIntoViewIfNeeded(); await shot('squiggle-7583-typed-hash');
    });
    await step('rapid-switch', async () => {
      await open('/?id=1234');
      await p.locator('#sec-model').scrollIntoViewIfNeeded();
      for (const sel of ['.disp[data-display=floating]', '.disp[data-display=backdrop]', '[data-format=mosaic]', '[data-scale=small]', '[data-format=relief]', '[data-scale=small]']) { await p.locator(sel).first().click(); await p.waitForTimeout(60); }
      await shown(['relief', 'backdrop', 'small']);
      await p.waitForTimeout(3000);
      const s = await st();
      const ui = await p.evaluate(() => ({ radios: [...document.querySelectorAll('[role=radio][aria-checked=true]')].map(b => b.dataset.format || b.dataset.display || b.dataset.scale), stats: document.getElementById('stats').innerText.split('\n')[0], manual: document.getElementById('manual-sub').textContent, shop: document.getElementById('shop-sum').textContent, sub: document.getElementById('model-sub').textContent, busy: !document.getElementById('busy').hidden }));
      check(s.format === 'relief' && s.display === 'backdrop' && s.scale === 'small' && [...ui.radios].sort().join() === 'backdrop,relief,small', 'six quick clicks end on the last choice (Relief · Backdrop · Small), picker marked', 'page', `${JSON.stringify(s)} · ${ui.radios}`);
      check(!ui.busy && ui.stats === s.pieces.toLocaleString('en') && ui.manual.includes(`${s.steps} steps`) && ui.manual.includes('Backdrop · Small') && ui.shop.startsWith(`${s.lots} lots`) && /Backdrop · Small/.test(ui.sub), 'after the quick clicks, figures, reader and shopping list are the Backdrop · Small ones', 'page', JSON.stringify(ui));
      await shot('rapid-switch');
    });
    await step('mosaic-files', async () => {
      await open('/?id=1234');
      await press('[data-format=mosaic]'); await shown(['mosaic', null, 'large']);
      await idle(() => !window.stb.stage.isPlaying, null, 60000).catch(() => {});
      await p.locator('#sec-model').scrollIntoViewIfNeeded(); await p.waitForTimeout(800); await shot('mosaic-built');
      const labels = await p.evaluate(() => [...document.querySelectorAll('#thumbs button')].map(b => b.textContent));
      check(!labels.some(l => /Hanging/.test(l)), 'the Mosaic booklet has no Hanging page', 'booklet', labels.join(', '));
      await readerPage('Step 1', 'mosaic-reader-step1');
      await readerPage(labels.at(-1), 'mosaic-reader-last');
      await exportsOf('mosaic-96x48');
    });
    await step('floating-backdrop-files', async () => {
      await open('/?id=7583');
      await press('.disp[data-display=floating]'); await shown(['relief', 'floating', 'large']);
      const fl = await p.evaluate(() => { const m = window.stb.model; return Object.entries(m.stepNotes || {}).map(([k, v]) => [+k, v]); });
      const hid = fl.find(([, v]) => /Hidden supports/.test(v));
      check(!!hid, 'Floating has a "Hidden supports" step note', 'models', JSON.stringify(fl).slice(0, 300));
      if (hid) await readerPage(`Step ${hid[0] + 1}`, 'floating-hidden-supports-page');
      await exportsOf('floating-7583');
      await press('.disp[data-display=backdrop]'); await shown(['relief', 'backdrop', 'large']);
      const bd = await p.evaluate(() => { const m = window.stb.model; return Object.entries(m.stepNotes || {}).map(([k, v]) => [+k, v]); });
      const light = bd.find(([, v]) => /Lighting/.test(v));
      check(!!light, 'Backdrop has a "Lighting notes" step note', 'models', JSON.stringify(bd).slice(0, 300));
      if (light) await readerPage(`Step ${light[0] + 1}`, 'backdrop-lighting-page');
      await exportsOf('backdrop-7583');
    });
    await step('video-while-switching', async () => {
      await open('/?id=1234');
      await p.locator('#sec-model').scrollIntoViewIfNeeded();
      const t0 = Date.now();
      const f = await download('video-switching', async () => {
        await press('#vid-square');
        await p.waitForTimeout(4000);
        await press('.disp[data-display=floating]');   // the visitor goes on looking while it records
        await p.waitForTimeout(2500);
        await press('[data-format=mosaic]');
        await p.waitForTimeout(1500);
        await shot('video-while-switching');
      }, 240000);
      const ff = ffprobe(f), ms = Date.now() - t0;
      R.files['video-switching'].ffprobe = ff;
      check(/squiggle-1234-frame-large-square\.(mp4|webm)$/.test(f) && ff.duration >= 15 && ff.duration <= 30 && !!ff.audio, 'a video started on the Frame stays the Frame while the visitor switches models (name, 15–30 s, sound)', 'motion', `${path.basename(f)} ${ff.duration?.toFixed?.(1)} s, audio ${!!ff.audio}, took ${(ms / 1000).toFixed(0)} s`);
      check(ms < 60000, 'the recording is not redone over and over (under 60 s)', 'motion', `${(ms / 1000).toFixed(0)} s`);
      try { sh('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', 'fps=1/1.5,scale=240:-1,tile=4x4', '-frames:v', '1', path.join(dir, `${String(++n).padStart(2, '0')}-video-switching-contact.jpg`)]); } catch { /* no ffmpeg */ }
      const s = await st();
      check(s.format === 'mosaic', 'the page shows the model picked meanwhile (Mosaic)', 'page', JSON.stringify(s));
    });
    await step('back-while-loading', async () => {
      await open('/?id=1234');
      await p.locator('#input-panel').scrollIntoViewIfNeeded();
      await press('#examples button >> nth=3');   // #102: an entry of this page's own history to go back to
      await idle(() => window.stb.loaded?.id === 102 && window.stb.model && document.getElementById('busy').hidden, null, 120000);
      await p.locator('#input-panel').scrollIntoViewIfNeeded();
      await p.locator('#sq-number').fill(''); await press('#sq-number'); await p.keyboard.type('7583'); await p.keyboard.press('Enter');
      await p.waitForTimeout(120);
      await p.goBack({ waitUntil: 'commit' }).catch(() => null);
      await p.waitForTimeout(6000);
      const r = await p.evaluate(() => ({ url: location.search, shown: window.stb.loaded?.id ?? null, title: document.getElementById('orig-title').textContent, field: document.getElementById('sq-number').value, result: !document.getElementById('result').hidden }));
      R.backWhileLoading = r;
      const urlId = new URLSearchParams(r.url).get('id');
      check(urlId === '1234' && r.shown === 1234 && r.title === 'Chromie Squiggle #1234' && r.field === '1234', 'Back while #7583 loads (after #1234 → #102): #1234 everywhere, #7583 dropped', 'page', JSON.stringify(r));
      await shot('back-while-loading');
    });
  }
  if (mobile && !flag('no-extras')) await step('chip-row', async () => {
    await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1200);
    const row = p.locator('#examples'); await row.scrollIntoViewIfNeeded();
    const rb = await row.boundingBox();
    const sw = await p.evaluate(() => { const e = document.getElementById('examples'); return { sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX }; });
    await touchDrag(p, rb.x + rb.width - 30, rb.y + rb.height / 2, rb.x + 20, rb.y + rb.height / 2 + 3, 10);
    await p.waitForTimeout(700);
    const sl = await p.evaluate(() => document.getElementById('examples').scrollLeft);
    await shot('chip-row-swiped');
    const chip = p.locator('#examples button', { hasText: '#1000' });
    const cb = await chip.boundingBox();
    const inView = cb && cb.x >= 0 && cb.x + cb.width <= p.viewportSize().width;
    check(sw.sw <= sw.cw || (sl > 0 && inView), 'a swipe on the example row brings the last chip (#1000) into view', 'page', `${JSON.stringify(sw)}, scrollLeft ${sl}, #1000 at ${JSON.stringify(cb)}`);
    if (cb) await p.touchscreen.tap(Math.min(cb.x + cb.width / 2, 380), cb.y + cb.height / 2);
    const ok = await idle(() => window.stb.loaded?.id === 1000 && window.stb.model && document.getElementById('busy').hidden, null, 120000).then(() => true, () => false);
    check(ok, 'tapping the #1000 chip builds #1000', 'page', JSON.stringify(await st()));
    await p.waitForTimeout(1500); await shot('chip-1000');
  });

  // ---- the LEGO word, the hosts ----
  await p.goto(new URL('/?id=1234', BASE).href, { waitUntil: 'load' }).catch(() => {});
  await idle(() => window.stb?.model && document.getElementById('busy').hidden, null, 120000).catch(() => {});
  R.lego = await p.evaluate(() => {
    const out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) for (const m of t.textContent.matchAll(/.{0,30}\bLEGO\b.{0,30}/g)) out.add(m[0].replace(/\s+/g, ' ').trim());
    for (const e of document.querySelectorAll('[alt],[title],[aria-label]')) for (const a of ['alt', 'title', 'aria-label']) { const v = e.getAttribute(a); if (v && /\bLEGO\b/.test(v)) out.add(`[${a}] ${v}`); }
    return [...out];
  });
  R.hosts = [...hosts].sort();
  const odd = R.hosts.filter(h => h && !/^localhost:\d+$/.test(h) && !/(^|\.)artblocks\.io$/.test(h) && h !== 'artblocks-mainnet.s3.amazonaws.com');
  check(!odd.length, 'the page talks only to itself and Art Blocks (no tracking)', 'page', R.hosts.join(', '));
  const productLego = R.lego.filter(t => /\bLEGO (Squiggle|kit|set|model|version|build)/i.test(t));
  check(!productLego.length, 'the page never names the product "LEGO …"', 'page', productLego.join(' | '));
  const errs = R.console.filter(c => c.type !== 'warning');
  const known = errs.filter(c => /Permissions policy violation: accelerometer/.test(c.text));
  check(errs.length === known.length, 'no console errors (other than the sandboxed script’s sensor notice)', 'page', errs.filter(c => !known.includes(c)).map(c => `[${c.step}] ${c.text} @${c.from}`).slice(0, 6).join(' | '));
  if (known.length) check(false, `the sandboxed p5 script logs "${known[0].text}" (${known.length}×)`, 'load', `${known[0].from} during ${[...new Set(known.map(c => c.step))].join(', ')}`);
  const g = await p.evaluate(() => ({ made: window.__gl.length, alive: window.__gl.filter(e => !e.lost).length })).catch(() => null);
  if (g) R.glEnd = g;
  const peak = R.gl.reduce((a, x) => (x.alive > a.alive ? x : a), { alive: 0 });
  check(peak.alive < 12, 'WebGL contexts stay well under the browser’s limit of 16', 'motion', `peak ${peak.alive} alive (${peak.made} made) after "${peak.where}"`);
  if (mobile) {
    const real = R.taps.filter(t => !t.inline);
    check(!real.length, 'every tap target on the phone is at least 40 px', 'page', real.map(t => `${t.el} "${t.text}" ${t.w}×${t.h} (${t.where})`).join('; '));
  }
  await ctx.close();
}

/** a one-finger drag through the DevTools protocol (touch events → pointer events) */
async function touchDrag(p, x0, y0, x1, y1, steps = 12) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] });
    await p.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  try { if (opt('only')) report.devices = JSON.parse(fs.readFileSync(path.join(ROOT, 'report.json'), 'utf8')).devices ?? {}; } catch { /* first run */ }
  const browser = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  for (const dev of Object.keys(DEVICES)) if (!opt('only') || opt('only') === dev) await walk(browser, dev).catch(e => { console.log(dev, 'CRASH', e); report.devices[dev] = { ...(report.devices[dev] || {}), crash: String(e.stack || e) }; });
  await browser.close();
  report.finished = new Date().toISOString();
  for (const [dev, r] of Object.entries(report.devices)) {
    if (opt('only') && `${opt('only')}${opt('steps') ? '-steps' : ''}` !== dev) continue;
    const bad = (r.checks || []).filter(c => !c.ok);
    console.log(`\n${dev}: ${(r.checks || []).length - bad.length}/${(r.checks || []).length} checks OK`);
    for (const c of bad) console.log(`  ✗ [${c.owner}] ${c.what} — ${c.evidence}`);
    if (r.console?.length) console.log(`  console: ${r.console.length} error/warning(s)`, r.console.slice(0, 6));
    if (r.failedRequests?.length) console.log('  failed requests:', r.failedRequests.slice(0, 8));
    if (r.taps?.length) console.log('  tap targets < 40 px:', r.taps.map(t => `${t.el} "${t.text}" ${t.w}×${t.h}${t.inline ? ' (inline)' : ''}`).join('; '));
  }
  fs.writeFileSync(path.join(ROOT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`\n${path.join(ROOT, 'report.json')}`);
})();
