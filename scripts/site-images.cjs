// The site's own pictures, rendered by the site: public/og.png (the share image of a Large Frame, 1200×630)
// and public/hero.jpg (that Frame on its wall, for the landing). Needs the dev server: npx vite --port 5180
//   node scripts/site-images.cjs [id] [--try]   (--try: hero candidates in out/hero-*.jpg, nothing written to public/)
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');
const fs = require('fs');
const id = +(process.argv.find(a => /^\d+$/.test(a)) ?? 13), tryOnly = process.argv.includes('--try');
const HERO = { w: 1120, h: 700, view: { az: -34, el: 12, margin: 0.07 } };   // three-quarter view: the relief reads as relief
(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:5180/?id=${id}`);
  await p.waitForFunction(() => window.stb?.model && window.stb.model.display === 'frame', null, { timeout: 90000 });
  const views = tryOnly ? [HERO.view, { az: -5, el: 4, margin: 0.06 }, { az: -34, el: 12, margin: 0.07 }, { az: 22, el: 10, margin: 0.07 }] : [HERO.view];
  const out = await p.evaluate(async ([views, W, H, share]) => {
    const [{ shareImage }, { Stage }] = await Promise.all([import('/src/squiggle/exports.ts'), import('/src/squiggle/stage.ts')]);
    const b64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); });
    const heroes = views.map(v => { const st = new Stage(W, H); st.setModel(window.stb.model, v); const u = st.toDataURL('image/jpeg', 0.84); st.dispose(); return u.split(',')[1]; });
    return { og: share ? await b64(await shareImage(window.stb.model, window.stb.loaded)) : null, heroes };
  }, [views, HERO.w, HERO.h, !tryOnly]);
  if (tryOnly) out.heroes.forEach((h, i) => { fs.writeFileSync(`out/hero-try-${i}.jpg`, Buffer.from(h, 'base64')); console.log(`out/hero-try-${i}.jpg`, JSON.stringify(views[i])); });
  else {
    fs.writeFileSync('public/og.png', Buffer.from(out.og, 'base64'));
    fs.writeFileSync('public/hero.jpg', Buffer.from(out.heroes[0], 'base64'));
    for (const f of ['public/og.png', 'public/hero.jpg']) console.log(f, Math.round(fs.statSync(f).size / 1024) + ' KB');
  }
  await b.close();
})();
