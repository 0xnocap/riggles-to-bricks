// The art for the QA sheet, rendered by the site's own renderer rather than by
// anything of ours: out/qa/art-<id>.png. Needs the dev server on 5180.
//   node scripts/qa-art.cjs 13,33,606
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');
const fs = require('fs');
const ids = (process.argv[2] ?? '13').split(',').map(Number);
(async () => {
  const b = await chromium.launch({ executablePath: exe() });
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:5180/?id=13');
  await p.waitForFunction(() => !!window.stb, null, { timeout: 90000 });
  fs.mkdirSync('out/qa', { recursive: true });
  for (const id of ids) {
    const b64 = await p.evaluate(async (id) => {
      const [m, d] = await Promise.all([import('/src/riggle/load.ts'), import('/src/data/riggles.json')]);
      const data = d.default ?? d;
      return m.riggleImage(String(data.riggles[id].h), undefined, 520, 'crop').split(',')[1];
    }, id);
    fs.writeFileSync(`out/qa/art-${id}.png`, Buffer.from(b64, 'base64'));
    console.log(`out/qa/art-${id}.png`);
  }
  await b.close();
})();
