// Booklet pages rendered in Chrome through the dev server (dev/booklet-lab.html):
// every page of each model to <out>/<id>-<mode>/NN.jpg, a contact sheet
// <out>/sheet-<id>.jpg, and the whole PDF of the first model, timed (<out>: out/booklet).
// Needs the dev server (npx vite --port 5180).
//   node scripts/booklet-shot.cjs [id] [modes] [--pages 1,3,9] [--no-pdf] [--port 5180] [--out dir]
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = k => { const i = args.indexOf('--' + k); if (i >= 0) args.splice(i, 1); return i >= 0; };
const port = opt('port', '5180'), only = opt('pages', null), out = opt('out', 'out/booklet').replace(/\/$/, ''), noPdf = flag('no-pdf');
const id = +(args[0] || 1234), modes = (args[1] || 'frame-large,floating-large,backdrop-large,mosaic-large').split(',');

(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text()); });
  p.on('response', r => { if (r.status() >= 400) console.log(r.status(), r.url()); });
  const open = async () => { await p.goto(`http://localhost:${port}/dev/booklet-lab.html`); await p.waitForFunction(() => window.bookletReady, null, { timeout: 60000 }); };
  // the dev server reloads the page when a source file changes: start that model again
  const run = async (fn, arg) => {
    for (let k = 0; ; k++) {
      try { return await p.evaluate(fn, arg); } catch (e) {
        if (k >= 3 || !/context was destroyed|navigation/i.test(e.message)) throw e;
        console.log('page reloaded, again'); await p.waitForTimeout(1500); await open();
      }
    }
  };
  await open();
  const sheet = [];
  for (const mode of modes) {
    const dir = `${out}/${id}-${mode}`;
    fs.mkdirSync(dir, { recursive: true });
    const t = Date.now();
    const r = await run(([id, mode, only]) => bk.pages(id, mode, only), [id, mode, only ? only.split(',').map(Number) : null]);
    for (const pg of r.pages) fs.writeFileSync(`${dir}/${String(pg.n).padStart(2, '0')}.jpg`, Buffer.from(pg.img.split(',')[1], 'base64'));
    console.log(`${dir}: ${r.pages.length}/${r.total} pages, ${r.steps} steps, ${r.pieces} pieces, ${Date.now() - t} ms (${r.pages.map(x => `${x.label} ${x.ms}`).join(', ')})`);
    sheet.push({ mode, ...r });
  }
  if (!noPdf) {
    const mode = modes[0], r = await run(([id, mode]) => bk.pdf(id, mode), [id, mode]);
    const file = `${out}/${id}-${mode}.pdf`;
    fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
    console.log(`${file}: ${(r.bytes / 1e6).toFixed(1)} MB in ${(r.ms / 1000).toFixed(1)} s`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:14px;font:12px system-ui;background:#f3f5f7;color:#1d2b36}h2{font-size:15px;margin:14px 0 6px}
.g{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}figure{margin:0}img{width:100%;display:block;border:1px solid #d5dce2;background:#fff}figcaption{color:#5a6b78;margin-top:2px}</style>
<h1 style="font-size:18px">Booklet · Chromie Squiggle #${id}</h1>${sheet.map(s => `<h2>${s.mode} · ${s.total} pages · ${s.steps} steps · ${s.pieces} pieces</h2><div class="g">${s.pages.map(pg => `<figure><img src="${pg.img}"><figcaption>${pg.n} · ${pg.label}</figcaption></figure>`).join('')}</div>`).join('')}`;
  const q = await b.newPage({ viewport: { width: 1800, height: 900 } });
  await q.setContent(html); await q.waitForTimeout(800);
  await q.screenshot({ path: `${out}/sheet-${id}.jpg`, fullPage: true, type: 'jpeg', quality: 80 });
  await b.close();
  console.log(`${out}/sheet-${id}.jpg`);
})();
