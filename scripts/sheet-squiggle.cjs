// Contact sheet of Squiggle models rendered by the Stage (dev/stage.html): per
// Squiggle, the Art Blocks picture then each model with its figures and checks.
// The 600×400 renders show at their native size (2× screenshot); notes shared by
// every model of a format are printed once, under the Art Blocks picture.
// Needs the dev server (npx vite --port 5180).
//   node scripts/sheet-squiggle.cjs [ids] [modes] [--name all] [--port 5180] [--dsf 2]
//   node scripts/sheet-squiggle.cjs --hero 1234 [--scale large]   → out/hero-1234-<mode>.jpg (1600×1000)
//   node scripts/sheet-squiggle.cjs --build 1234 [modes] [--ghosts 1] → out/build-1234.jpg (build animation filmstrips)
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const hero = opt('hero'), anim = opt('build'), ghosts = opt('ghosts') === '1', name = opt('name', 'squiggle'), port = opt('port', '5180'), heroScale = opt('scale', 'large'), dsf = +opt('dsf', '2');
const ids = (args[0] || '0,1,1234,3784,7583,9999,102,1000,1004,10,1047').split(',').map(Number);
const modes = (args[1] || 'mosaic-small,mosaic-large,frame-small,frame-large,floating-small,backdrop-small').split(',');
const parse = m => { const [a, s = 'small'] = m.split('-'); return a === 'mosaic' ? ['mosaic', null, s] : ['relief', a, s]; };
const cap = s => s[0].toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const notes = (list, lead = '') => list.length ? `<div class="n" title="${esc(list.join('\n'))}">${lead}${esc(list.join(' · '))}</div>` : '';

(async () => {
  fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:${port}/dev/stage.html`);
  await p.waitForFunction(() => window.stageReady, null, { timeout: 60000 });
  const report = (id, mode, w, h, quality) => p.evaluate(([id, [f, d, s], w, h, quality]) => sq.report(id, f, d, s, { width: w, height: h, quality }), [id, parse(mode), w, h, quality]);

  if (anim) {
    const at = [0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92, 1];
    const list = args[0] ? args[0].split(',') : ['frame-large', 'floating-large', 'backdrop-large', 'mosaic-large'];
    const rows = [];
    for (const mode of list) {
      const r = await p.evaluate(([id, mode, at, ghosts]) => sq.buildFrames(id, mode, at, { width: 480, height: 320, ghosts }), [+anim, mode, at, ghosts]);
      rows.push(`<div class="t">#${anim} · ${mode} · ${r.pieces} pieces · ${r.steps} steps · built in ${r.built.toFixed(1)} s</div><div class="r">${r.frames.map(f => `<figure><img src="${f.img}"><figcaption>${f.t.toFixed(1)} s</figcaption></figure>`).join('')}</div>`);
      process.stdout.write('.');
    }
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:12px;font:12px system-ui;background:#f3f5f7;color:#1d2b36}.t{font-weight:700;margin:10px 0 4px}.r{display:grid;grid-template-columns:repeat(${at.length},240px);gap:6px}figure{margin:0}img{width:240px;border-radius:6px;display:block}figcaption{color:#5a6b78;font-size:11px}</style>${rows.join('')}`;
    const q = await b.newPage({ viewport: { width: at.length * 246 + 24, height: 900 }, deviceScaleFactor: 2 });
    await q.setContent(html); await q.waitForTimeout(500);
    const file = `out/build-${anim}${ghosts ? '-ghosts' : ''}.jpg`;
    await q.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 82 });
    await b.close();
    console.log('\n' + file);
    return;
  }

  if (hero) {
    for (const mode of ['frame', 'floating', 'backdrop', 'mosaic'].map(m => `${m}-${heroScale}`)) {
      const r = await report(+hero, mode, 1600, 1000, 0.93);
      const file = `out/hero-${hero}-${mode.split('-')[0]}.jpg`;
      if (r.ok) { fs.writeFileSync(file, Buffer.from(r.img.split(',')[1], 'base64')); console.log(file, `${r.pieces} pieces`); }
      else console.log(file, 'FAILED:', r.error);
    }
    await b.close();
    return;
  }

  const rows = [];
  for (const id of ids) {
    const orig = await p.evaluate(id => sq.original(id, 600), id).catch(e => null);
    const cells = [];
    for (const mode of modes) cells.push({ mode, ...(await report(id, mode, 600, 400, 0.85)) });
    const f = await p.evaluate(id => sq.fixture(id).then(x => x.features), id).catch(() => ({}));
    // notes every model of a format shares (the ribbon's, for the reliefs)
    const common = {};
    for (const fmt of ['mosaic', 'relief']) {
      const same = cells.filter(c => c.ok && parse(c.mode)[0] === fmt);
      common[fmt] = same.length > 1 ? (same[0].notes ?? []).filter(n => same.every(c => c.notes?.includes(n))) : [];
    }
    rows.push({ id, orig, cells, f, common });
    process.stdout.write('.');
  }

  const ok = v => `<b class="${v ? 'ok' : 'bad'}">`;
  const chk = (label, v, good) => v === null || v === undefined ? `<span class="na">${label} —</span>` : `${ok(good(v))}${label} ${v === true ? '✓' : v === false ? '✗' : v}</b>`;
  const kg = g => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);
  const size = c => c.pose === 'wall' ? `${c.dims[0]} × ${c.dims[2]} cm, ${c.dims[1]} cm deep` : `${c.dims[0]} × ${c.dims[1]} cm, ${c.dims[2]} cm high`;
  let green = 0, total = 0;
  const cell = (c, common) => {
    const [f, d, s] = parse(c.mode), title = `${cap(d ?? f)} · ${s}`;
    total++;
    if (!c.ok) return `<div class="c"><div class="t">${title}</div><div class="err">${c.error}</div></div>`;
    const k = c.checks, rulesOk = k.rules.every(r => r.ok);
    const all = k.collisions === 0 && k.floating === 0 && (k.twoStud ?? 0) === 0 && k.comInside !== false && rulesOk;
    if (all) green++;
    return `<div class="c"><div class="t">${title} <span class="${all ? 'ok' : 'bad'}">${all ? '✓ all checks' : '✗ FAILED'}</span></div><img src="${c.img}">
<div><b>${c.pieces}</b> pieces · Squiggle ${c.subtotals.squiggle.pieces} / Display ${c.subtotals.display.pieces} · ${c.lots} lots</div>
<div>${size(c)} · ${kg(c.grams)} · ≈ €${Math.round(c.cost)} · ${c.ms} ms</div>
<div class="k">${chk('collisions', k.collisions, v => v === 0)} ${chk('floating', k.floating, v => v === 0)} ${chk('twoStud', k.twoStud, v => v === 0)} ${chk('comInside', k.comInside, v => v === true)}</div>
<div class="k">${k.rules.map(r => `${ok(r.ok)}${r.ok ? '✓' : '✗'} ${r.name}</b>${r.ok ? '' : ` <span class="d">${r.detail ?? ''}</span>`}`).join(' · ') || '<span class="na">no rules</span>'}</div>
${notes((c.notes ?? []).filter(n => !common[f].includes(n)))}</div>`;
  };
  const body = rows.map(r => `<div class="r"><div class="c o"><div class="t">#${r.id} · ${r.f.Type ?? ''} · ${r.f.Spectrum ?? ''}</div>${r.orig ? `<img src="${r.orig}">` : '<div class="err">no fixture</div>'}<div class="n">Art Blocks, redrawn from the fixture</div>${notes(r.common.relief, '<b>Every relief:</b> ')}${notes(r.common.mosaic, '<b>Every mosaic:</b> ')}</div>${r.cells.map(c => cell(c, r.common)).join('')}</div>`).join('');
  // columns sized so a 600 px render shows 1:1 at the screenshot's scale
  const cols = modes.length + 1, col = Math.round(600 / dsf) + 14, width = cols * col + (cols - 1) * 8 + 28;
  const html = `<!doctype html><meta charset="utf-8"><title>Squiggle sheet · ${name}</title><style>body{margin:14px;font:11.5px/1.4 system-ui;background:#f3f5f7;color:#1d2b36}h1{font-size:18px;margin:0 0 10px}
.r{display:grid;grid-template-columns:repeat(${cols},${col}px);gap:8px;margin-bottom:10px}.c{background:#fff;border-radius:10px;padding:7px;min-width:0}.c img{width:100%;border-radius:6px;display:block;margin:4px 0}
.t{font-weight:700;font-size:12.5px}.k{margin-top:2px}.ok{color:#17794b}.bad{color:#c0340c;font-weight:800}.na{color:#8a96a0}.d{color:#c0340c;font-weight:400}.err{color:#c0340c;margin-top:8px}
.n{font-size:10.5px;color:#7a6400;margin-top:3px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.o .n{color:#5a6b78;-webkit-line-clamp:6}.o img{border:1px solid #e1e5e9;box-sizing:border-box}</style>
<h1>Squiggle to Bricks · ${rows.length} Squiggles × ${modes.length} models · ${green}/${total} with every check green</h1>${body}`;
  const out = `out/sheet-${name}`;
  fs.writeFileSync(out + '.html', html);
  const q = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: dsf });
  await q.setContent(html); await q.waitForTimeout(800);
  await q.screenshot({ path: out + '.jpg', fullPage: true, type: 'jpeg', quality: 82 });
  await b.close();
  console.log(`\n${out}.jpg · ${green}/${total} green`);
})();
