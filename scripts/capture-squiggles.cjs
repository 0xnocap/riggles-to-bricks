// Record the test Squiggles as fixtures (token + every circle the original
// script draws), so builders and tests run in Node without Art Blocks.
// Needs the dev server: npx vite --port 5180, then node scripts/capture-squiggles.cjs [ids]
const { chromium } = require('playwright-core');
const fs = require('fs');
const { exe } = require('./shot.cjs');
const IDS = (process.argv[2] ?? '0,1,1234,3784,7583,9999,102,1000,1004,10,1047').split(',').map(Number);
(async () => {
  const b = await chromium.launch({ executablePath: exe() });
  const p = await b.newPage();
  await p.goto('http://localhost:5180/dev/stage.html');
  for (const id of IDS) {
    const f = await p.evaluate(async (id) => {
      const m = await import('/src/squiggle/source.ts');
      const t = await m.fetchSquiggle(id), r = await m.renderSquiggle(t, 1200, 0);
      const q = (v) => Math.round(v * 100) / 100;
      return { id, hash: t.hash, features: t.features, width: r.width, height: r.height, dots: r.dots.map(d => [q(d.x), q(d.y), q(d.d), d.fill, d.stroke]) };
    }, id);
    fs.writeFileSync(`test/fixtures/squiggles/${id}.json`, JSON.stringify(f));
    console.log(id, f.features.Type, f.dots.length);
  }
  await b.close();
})();
