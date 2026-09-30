// The input chain on the dev server (dev/load-lab.html): Squiggle #1234 with every
// fallback forced in turn, then uploads (a PNG made from the port's circles,
// cropped, a JPEG, screenshots of it on a page, a picture that is no Squiggle,
// and one through the file input), then Art Blocks hanging. For each: where the
// curve came from, its points, and the large Frame built from it (0 floating,
// 0 collisions), and the console errors it caused (none expected: e.g. no fetch of a
// picture address without CORS headers). Needs the dev server: npx vite --port 5180
// Usage: node scripts/fallbacks.cjs [id] [out-dir]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { exe } = require('./shot.cjs');
const ID = +(process.argv[2] ?? 1234), OUT = process.argv[3] ?? 'out';
const URL = 'http://localhost:5180/dev/load-lab.html';

(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  let consoleErrors = [];
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await p.goto(URL);
  await p.waitForFunction(() => window.labReady);
  // the dev server may reload the page (a file changed, dependencies optimized): wait and retry once
  const ev = async (fn, arg) => {
    try { return await p.evaluate(fn, arg); }
    catch (e) {
      if (!/context was destroyed|navigation/i.test(e.message)) throw e;
      await p.waitForLoadState(); await p.waitForFunction(() => window.labReady);
      return p.evaluate(fn, arg);
    }
  };
  const rows = [], noisy = [];
  const line = (name, s) => {
    rows.push({ name, ...s });
    if (consoleErrors.length) { noisy.push(name); console.log(`${name.padEnd(26)} console errors: ${consoleErrors.join(' | ')}`); }
    consoleErrors = [];
    if (s.error) return console.log(`${name.padEnd(26)} ERROR ${s.error}`);
    const f = s.frame;
    console.log(`${name.padEnd(26)} origin ${s.origin.padEnd(6)} type ${s.type.padEnd(6)} points ${String(s.points).padStart(5)}  load ${String(s.loadMs).padStart(5)} ms  build ${String(s.buildMs).padStart(5)} ms  Frame ${f.pieces} pieces, ${f.floating} floating, ${f.collisions} collisions, twoStud ${f.twoStud}${f.rules.length ? `, failed rules: ${f.rules.join(', ')}` : ''}`);
  };
  for (const fail of [[], ['generator'], ['token', 'generator']]) {
    const s = await ev(([id, fail]) => lab.attempt(`#${id} fail ${fail.join(',')}`, id, { fail }), [ID, fail]);
    line(`#${ID} fail [${fail.join(',')}]`, s);
  }
  // the last resort: nothing reachable
  line(`#${ID} fail [token,generator,image]`, await ev(id => lab.attempt('all fail', id, { fail: ['token', 'generator', 'image'] }), ID));
  // uploads made in the page from the port's circles (#7583 and #102)
  const HASH = { 7583: '0x583840fc413a729152edfc00e4abd3a6ade316833858a3df2e0245f824a58f37', 102: '0x1db0e2f129b2f4bad06e3e5860357e2c676ce6fedafac40428c0caf128bff424' };
  for (const [id, width, crop, type] of [[7583, 900, 0, 'image/png'], [7583, 1500, 0.08, 'image/png'], [102, 1200, 0, 'image/jpeg']]) {
    const s = await ev(async ([hash, width, crop, type]) => lab.attempt(`upload ${width} crop ${crop} ${type}`, await lab.makePicture(hash, width, crop, type)), [HASH[id], width, crop, type]);
    line(`upload #${id} ${width}${crop ? ' cropped' : ''} ${type.slice(6)}`, s);
  }
  // screenshots: the Squiggle's picture on a page, cut out and read as the whole canvas (type and segments right)
  const wrong = [];
  for (const [name, id, o] of [
    ['screenshot on a grey page', 7583, {}],
    ['screenshot on a black page', 102, { page: '#000', ink: '#eee' }],
    ['small JPEG on grey', 7583, { W: 1400, H: 1400, x: 380, y: 487, width: 640, page: '#9a9a9a' }],
  ]) {
    const s = await ev(async ([hash, o]) => { const { blob, truth } = await lab.makeScreenshot(hash, o); return { ...(await lab.attempt(`upload ${JSON.stringify(o)}`, blob)), truth }; }, [HASH[id], o]);
    line(`upload #${id} ${name}`, s);
    const cut = !s.error && s.notes.some(n => /cut out/.test(n));
    if (s.error || s.type !== s.truth.Type || s.features.Segments !== s.truth.Segments || !cut) wrong.push(name);
    console.log(`${''.padEnd(26)} ${s.error ? '' : `read ${s.type} ${s.features.Segments} segments (truth ${s.truth.Type} ${s.truth.Segments}), cut out of the page: ${cut}`}`);
  }
  // a colourful picture that is no Squiggle: refused
  const junk = await ev(async () => lab.attempt('not a Squiggle', await lab.makeJunk()));
  line('upload not a Squiggle', junk);
  if (!/couldn’t find a Squiggle/.test(junk.error ?? '')) wrong.push('not a Squiggle');
  // and one through the file input, as a visitor would
  fs.mkdirSync(OUT, { recursive: true });
  const png = await ev(async hash => { const b = await lab.makePicture(hash, 1200); return [...new Uint8Array(await b.arrayBuffer())]; }, HASH[7583]);
  const file = path.join(OUT, 'fallbacks-upload.png');
  fs.writeFileSync(file, Buffer.from(png));
  await p.evaluate(() => { window.lastUpload = null; });
  await p.setInputFiles('#file', file);
  await p.waitForFunction(() => window.lastUpload, null, { timeout: 60000 });
  line('upload via file input', await p.evaluate(() => window.lastUpload));
  await p.screenshot({ path: path.join(OUT, 'fallbacks.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
  // Art Blocks and S3 hanging (no answer at all): "slow" after 10 s, the upload offer within about 20 s
  const hung = await b.newPage();
  await hung.route(u => /(^|\.)(artblocks\.io|amazonaws\.com)$/.test(u.host), route => new Promise(r => setTimeout(r, 60000)).then(() => route.abort().catch(() => {})));
  await hung.goto(URL); await hung.waitForFunction(() => window.labReady);
  const h = await hung.evaluate(id => lab.attempt('Art Blocks hanging', id), ID);
  console.log(`${'Art Blocks hanging'.padEnd(26)} ${h.error ? `“${h.error}” after ${(h.ms / 1000).toFixed(1)} s, “slow” said after ${h.slowMs === null ? '(never)' : (h.slowMs / 1000).toFixed(1) + ' s'}` : `origin ${h.origin}`}`);
  if (!/upload/.test(h.error ?? '') || h.ms > 22000 || !(Math.abs(h.slowMs - 10000) < 1000)) wrong.push('Art Blocks hanging');
  await b.close();
  const bad = rows.filter(r => !r.error && (r.frame.floating || r.frame.collisions || r.frame.twoStud || r.frame.rules.length));
  const expected = ['script', 'port', 'image'], got = rows.slice(0, 3).map(r => r.origin);
  console.log(`\norigins ${got.join(' → ')} (expected ${expected.join(' → ')}); models with problems: ${bad.length}; misread: ${wrong.join(', ') || 'none'}; console errors: ${noisy.join(', ') || 'none'}; screenshot ${path.join(OUT, 'fallbacks.jpg')}`);
  process.exit(bad.length || wrong.length || noisy.length || got.join() !== expected.join() || rows[3].error === undefined ? 1 : 0);
})();
