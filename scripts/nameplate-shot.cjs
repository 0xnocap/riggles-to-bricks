// Render a Squiggle's printable nameplate PNGs (plain, with cut marks, 3D texture)
// in Chrome through the dev server, save them to out/ and measure the text box.
// Needs the dev server: npx vite --port 5180, then node scripts/nameplate-shot.cjs [id]
const { chromium } = require('playwright-core');
const fs = require('fs');
const { PNG } = require('pngjs');
const { exe } = require('./shot.cjs');
const id = +(process.argv[2] ?? 1234);
const { hash } = JSON.parse(fs.readFileSync(`test/fixtures/squiggles/${id}.json`, 'utf8'));

/** bounding box of the light (text) pixels, and of the opaque (face) pixels */
function measure(buf) {
  const p = PNG.sync.read(buf), box = () => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1 }), ink = box(), face = box();
  const add = (b, x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
  const px = (x, y) => p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const [r, g, b, a] = px(x, y);
    if (a > 200 && r < 60 && g < 60 && b < 60) add(face, x, y);
  }
  const r = Math.ceil((face.y1 - face.y0) * 0.05);   // skip the rounded corners
  for (let y = face.y0 + r; y <= face.y1 - r; y++) for (let x = face.x0 + r; x <= face.x1 - r; x++) {
    const [r, g, b, a] = px(x, y);
    if (a > 200 && r > 128 && g > 128 && b > 128) add(ink, x, y);
  }
  return { width: p.width, height: p.height, face, ink };
}
const dpiOf = (b) => { const i = b.indexOf('pHYs'); return i < 0 ? null : Math.round(b.readUInt32BE(i + 4) * 0.0254); };

(async () => {
  const b = await chromium.launch({ executablePath: exe() });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:5180/test/fixtures/squiggles/${id}.json`);
  const files = await p.evaluate(async ([id, hash]) => {
    const m = await import('/src/squiggle/nameplate.ts'), lines = m.nameplateLines(id, hash);
    const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const tex = await new Promise(ok => m.nameplateCanvas(lines, 1024).toBlob(ok, 'image/png'));
    return { lines, plain: await b64(await m.nameplatePNG(lines)), cut: await b64(await m.nameplatePNG(lines, 600, { cutMarks: true })), texture: await b64(tex) };
  }, [id, hash]);
  await b.close();
  fs.mkdirSync('out', { recursive: true });
  console.log(files.lines.join(' / '));
  for (const [k, suffix] of [['plain', ''], ['cut', '-cut'], ['texture', '-texture']]) {
    const buf = Buffer.from(files[k], 'base64'), out = `out/nameplate-${id}${suffix}.png`, s = measure(buf);
    fs.writeFileSync(out, buf);
    const fw = s.face.x1 - s.face.x0 + 1, fh = s.face.y1 - s.face.y0 + 1;
    const left = s.ink.x0 - s.face.x0, right = s.face.x1 - s.ink.x1, top = s.ink.y0 - s.face.y0, bottom = s.face.y1 - s.ink.y1;
    console.log(`${out}: ${s.width}×${s.height} px, ${dpiOf(buf) ?? '-'} dpi, black area ${fw}×${fh}, text margins L ${left} R ${right} T ${top} B ${bottom} px = L ${(100 * left / fw).toFixed(1)}% R ${(100 * right / fw).toFixed(1)}% T ${(100 * top / fh).toFixed(1)}% B ${(100 * bottom / fh).toFixed(1)}%`);
  }
})();
