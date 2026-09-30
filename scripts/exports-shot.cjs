// Render Squiggle share images (and optionally the kit ZIP) in Chrome through the
// dev server and the exports lab page, save them to out/ (or --out=dir) and list the kit's files.
// Needs the dev server: npx vite --port 5180, then
//   node scripts/exports-shot.cjs [1234:frame-large,7583:backdrop-large] [--kit] [--remote] [--out=dir]
const { chromium } = require('playwright-core');
const fs = require('fs');
const { exe } = require('./shot.cjs');
const args = process.argv.slice(2), list = (args.find(a => !a.startsWith('--')) ?? '1234:frame-large,7583:backdrop-large').split(',');
const dir = (args.find(a => a.startsWith('--out=')) ?? '--out=out').slice(6);

/** names and sizes of the files in a stored (uncompressed) ZIP */
function zipEntries(buf) {
  const out = [];
  for (let i = 0; i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50;) {
    const size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), x = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + n).toString('utf8');
    out.push({ name, size, data: buf.subarray(i + 30 + n + x, i + 30 + n + x + size) });
    i += 30 + n + x + size;
  }
  return out;
}

(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  // the dev server reloads the page when another file changes: open it and run again on a fresh page
  const reloaded = e => /context was destroyed|window\.ex|interrupted by another navigation|Timeout/.test(e.message);
  const open = async () => {
    for (let i = 0; ; i++) {
      try { await p.goto('http://localhost:5180/dev/exports-lab.html'); return await p.waitForFunction(() => window.ex); } catch (e) { if (i > 8 || !reloaded(e)) throw e; await p.waitForTimeout(1000); }
    }
  };
  const run = async (fn, arg) => {
    for (let i = 0; ; i++) {
      try { return await p.evaluate(fn, arg); } catch (e) { if (i > 8 || !reloaded(e)) throw e; await open(); }
    }
  };
  await open();
  fs.mkdirSync(dir, { recursive: true });
  for (const item of list) {
    const [id, mode = 'frame-large'] = item.split(':');
    const r = await run(([id, mode, remote]) => window.ex.share(id, mode, remote), [+id, mode, args.includes('--remote')]);
    const out = `${dir}/share-${id}-${mode}${args.includes('--remote') ? '-remote' : ''}.png`;
    fs.writeFileSync(out, Buffer.from(r.png, 'base64'));
    console.log(`${out}: ${r.pieces} pieces · ${r.size} · ${r.ms} ms`);
    if (!args.includes('--kit')) continue;
    const k = await run(([id, mode]) => window.ex.kit(id, mode), [+id, mode]);
    const zip = Buffer.from(k.zip, 'base64'), zout = `${dir}/${k.name}-kit.zip`;
    fs.writeFileSync(zout, zip);
    console.log(`${zout}: ${(zip.length / 1024).toFixed(0)} KB`);
    for (const e of zipEntries(zip)) console.log(`  ${e.name.padEnd(48)} ${e.size.toLocaleString('en').padStart(10)} bytes`);
    const readme = zipEntries(zip).find(e => e.name === 'README.txt');
    if (readme && args.includes('--readme')) console.log('\n' + readme.data.toString('utf8'));
  }
  await b.close();
})();
