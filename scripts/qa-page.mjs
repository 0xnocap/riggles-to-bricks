// Build the QA page: every sheet's art and both builds, side by side.
//   node scripts/qa-page.mjs <out.html>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const out = process.argv[2] ?? 'out/qa.html';
const man = JSON.parse(readFileSync('out/qa/manifest.json', 'utf8'));
const uri = f => existsSync(`out/qa/${f}`) ? `data:image/png;base64,${readFileSync(`out/qa/${f}`).toString('base64')}` : '';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const rows = man.map(r => {
  const tags = [r.intensity, r.legendary, r.greyscale ? 'greyscale' : null, r.background === 'Lime' ? 'volt background' : null]
    .filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  return `<section class="riggle">
  <header class="rh">
    <h2>#${r.id}</h2>
    <p class="kind">${esc(r.type)}</p>
    <div class="tags">${tags}</div>
    <p class="count">${r.reliefPieces} pieces relief · ${r.mosaicPieces} mosaic</p>
  </header>
  <div class="three">
    <figure><img loading="lazy" alt="Riggle ${r.id}, the art" src="${uri(`art-${r.id}.png`)}"><figcaption>Art</figcaption></figure>
    <figure><img loading="lazy" alt="Riggle ${r.id}, built as a relief" src="${uri(`relief-${r.id}.png`)}"><figcaption>Relief</figcaption></figure>
    <figure><img loading="lazy" alt="Riggle ${r.id}, built as a mosaic" src="${uri(`mosaic-${r.id}.png`)}"><figcaption>Mosaic</figcaption></figure>
  </div>
</section>`;
}).join('\n');

const html = `<title>Riggles to Bricks QA</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
  /* a worksheet: one row per riggle, the art and both builds at one size */
  :root {
    --bg: #f6f6f4; --panel: #ffffff; --line: #e0e0dc; --fg: #1a1a18; --dim: #6a6a64;
    --accent: #0b7a55; --tile: #26262a;
    --display: 'Archivo', system-ui, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg: #121214; --panel: #1a1a1d; --line: #2c2c31; --fg: #ececea; --dim: #96968e; --accent: #4fd6a0; color-scheme: dark;
  } }
  :root[data-theme="dark"] {
    --bg: #121214; --panel: #1a1a1d; --line: #2c2c31; --fg: #ececea; --dim: #96968e; --accent: #4fd6a0; color-scheme: dark;
  }
  body { background: var(--bg); color: var(--fg); font-family: var(--display); margin: 0; }
  .wrap { max-width: 1180px; margin: 0 auto;
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
    padding-block: 32px 64px; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.3rem); margin: 0 0 .4em; text-wrap: balance; letter-spacing: -.02em; }
  .lede { color: var(--dim); max-width: 62ch; line-height: 1.55; margin: 0 0 1.2em; }
  .lede b { color: var(--fg); font-weight: 600; }
  .known { border: 1px solid var(--line); background: var(--panel); border-radius: 10px; padding: 18px 20px; margin-bottom: 40px; }
  .known h3 { margin: 0 0 .6em; font-size: .78rem; text-transform: uppercase; letter-spacing: .09em; color: var(--accent); }
  .known ul { margin: 0; padding-left: 1.1em; color: var(--dim); line-height: 1.6; }
  .known li { margin-bottom: .4em; }
  .known li b { color: var(--fg); font-weight: 600; }
  .riggle { border-top: 1px solid var(--line); padding-block: 26px; display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 24px; align-items: start; }
  .rh h2 { font-family: var(--mono); font-size: 1.5rem; margin: 0; letter-spacing: -.02em; }
  .kind { margin: .1em 0 .6em; font-weight: 500; }
  .count { font-family: var(--mono); font-size: .72rem; color: var(--dim); margin: .9em 0 0; font-variant-numeric: tabular-nums; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { font-family: var(--mono); font-size: .66rem; border: 1px solid var(--line); color: var(--dim); border-radius: 99px; padding: 2px 8px; }
  .three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; min-width: 0; }
  figure { margin: 0; min-width: 0; }
  figure img { display: block; width: 100%; max-width: 100%; border-radius: 6px; background: var(--tile); border: 1px solid var(--line); }
  figcaption { font-family: var(--mono); font-size: .68rem; color: var(--dim); margin-top: 5px; text-transform: uppercase; letter-spacing: .08em; }
  @media (max-width: 760px) {
    .riggle { grid-template-columns: 1fr; gap: 14px; }
    .three { gap: 8px; }
    figcaption { font-size: .6rem; }
  }
</style>
<div class="wrap">
  <h1>Riggles to Bricks QA</h1>
  <p class="lede">Every riggle type, every Intensity, and each legendary. The art on the left is drawn by the
  collection's own engine, the way the site draws it. The two builds beside it are the model the site would
  hand you, on the riggle's own background. <b>All three are fitted to the same box</b>, so the shapes line up
  and the colours can be read against each other.</p>

  <div class="known">
    <h3>Fixed</h3>
    <ul>
      <li><b>Corrugated is a lattice again, in the Mosaic.</b> The engine only strokes a square outline
      every S/3.6 and never fills it, so the holes are the body. It was being swept solid. 355 riggles are
      Corrugated.</li>
    </ul>
    <h3 style="margin-top:1.2em">The Relief cannot build three of the bodies</h3>
    <ul>
      <li>I built it and took it out again. A Relief is a raised body of laminated layers, laid as pieces of
      at least two studs that overlap to hold together, and on the Floating display it carries itself with no
      panel under it. Its ribbon is 3 to 11 studs wide, median 4. Corrugated's lattice bars, Outline's
      hairline and Pixelated's scattered cells are all one stud wide, which it cannot lay or bond. Built
      anyway, 11 models came out with pieces held by nothing, and they still read as solid, because at the
      Relief's scale a Corrugated's holes are 8 studs across a 7 stud band and simply miss it.</li>
      <li>The Mosaic has the room: flat tiles on a base plate, on a grid about a third finer, with no
      bonding to satisfy. That is why it can hold a one stud contour and the Relief cannot.</li>
      <li><b>426 riggles, 19 per cent of the collection, are one of these three.</b> They each build correctly
      as a Mosaic. Whether the Relief should still be offered for them is yours to call.</li>
    </ul>
    <h3 style="margin-top:1.2em">Still open</h3>
    <ul>
      <li><b>Outline's contour is a stud thick</b> in the Mosaic against a hairline in the art. One stud is
      the floor; it can only get thinner in proportion if the whole model is built larger.</li>
      <li><b>Colour does not hold square blocks, and some hues are still off.</b> Not started.</li>
    </ul>
    <h3 style="margin-top:1.2em">Checked, and faithful</h3>
    <ul>
      <li><b>Outline shape and spacing.</b> Compared stud for stud on each build's own mapping, the Relief
      fills nothing the art does not cover; #44 differs by one column. The gaps that close are the art's own,
      0.9 to 1.9 studs wide at this size.</li>
    </ul>
  </div>

${rows}
</div>`;
writeFileSync(out, html);
console.log(`${out}  ${man.length} riggles, ${(Buffer.byteLength(html) / 1e6).toFixed(2)} MB`);
