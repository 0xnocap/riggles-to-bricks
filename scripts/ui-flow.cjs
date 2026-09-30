// The visitor's journey, proven in Chrome on desktop (1400×900) and mobile (390×844): wrong numbers → type 1234 →
// the original → the Frame builds → Floating, Backdrop, Mosaic, sizes → the reader (a swipe on the phone) → every
// download (checked) → Before you order → the LEGO guide → the BrickLink copy → tap sizes, section menu, a second
// Squiggle and Back/Forward. Layout on the way: a brick picture on the phone's first screen, the stage shaped like the
// model, figures and part names never cut, the reader's arrows off the page. Then the fallbacks (?fail=, Art Blocks unreachable or hanging), an upload, and the time to the first
// model with the CPU slowed 6×. Screenshots and a summary in out/flow/. Needs the dev server: npx vite --port 5180
//   node scripts/ui-flow.cjs [--only desktop|mobile] [--no-video] [--docs]  (--docs also writes docs/*.png for the README)
const { chromium } = require('playwright-core');
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { exe } = require('./shot.cjs');

const args = process.argv.slice(2), flag = k => args.includes('--' + k), opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const BASE = opt('url') || 'http://localhost:5180/', OUT = 'out/flow', ID = 1234;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const fail = [];
const check = (ok, what) => { log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) fail.push(what); };
const has = cmd => { try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const pngSize = f => { const b = fs.readFileSync(f); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
/** a one-finger drag through the DevTools protocol (touch events, as on a phone) */
async function touchDrag(p, x0, y0, x1, y1, steps = 10) {
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const devices = { desktop: { viewport: { width: 1400, height: 900 } }, mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
  const summary = {};
  for (const dev of Object.keys(devices)) {
    if (opt('only') && opt('only') !== dev) continue;
    log(`\n===== ${dev} =====`);
    const ctx = await b.newContext({ ...devices[dev], acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
    const p = await ctx.newPage();
    const errs = [], hosts = new Set();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/accelerometer|Permissions policy/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
    p.on('request', r => hosts.add(new URL(r.url()).host));
    let n = 0;
    // element shots scroll the element into place: the sticky section menu would land on top of it, so it steps aside
    const hideNav = on => p.evaluate(on => { document.getElementById('secnav').style.visibility = on ? 'hidden' : ''; }, on);
    const snap = async (sel, file) => { await hideNav(true); await p.locator(sel).screenshot({ path: file }); await hideNav(false); };
    const shot = async (name, sel) => { const f = `${OUT}/${dev}-${String(++n).padStart(2, '0')}-${name}.png`; if (sel) await snap(sel, f); else await p.screenshot({ path: f }); return f; };
    const state = () => p.evaluate(() => { const s = window.stb, m = s.model; return m && { format: m.format, display: m.display, scale: m.scale, pieces: m.pieces.length, playing: s.stage?.isPlaying, t: s.stage?.time, stats: [...document.querySelectorAll('#stats .stat')].map(e => e.innerText.replace(/\n/g, ' ')), sub: document.getElementById('model-sub').innerText.replace(/\n/g, ' · '),
      cut: [...document.querySelectorAll('#stats b, #stats .sub i')].filter(e => e.getBoundingClientRect().right > e.closest('.stat').getBoundingClientRect().right - 2).map(e => e.textContent) }; });
    const settle = async (want) => {
      await p.waitForFunction(w => { const m = window.stb?.model; return m && m.format === w.format && (w.format === 'mosaic' || m.display === w.display) && m.scale === w.scale && document.getElementById('busy').hidden; }, want, { timeout: 90000 });
    };
    const dl = async (click, timeout = 120000) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout }), click()]); const f = path.join(OUT, `${dev}-${d.suggestedFilename()}`); await d.saveAs(f); return { name: d.suggestedFilename(), file: f, size: fs.statSync(f).size }; };

    // 1. a mistyped link says why nothing loads, then the landing
    const badLinks = [];
    for (const v of ['abc', '10000', '-1', '']) {
      await p.goto(`${BASE}?id=${v}`); await p.waitForTimeout(250);
      badLinks.push(await p.evaluate(v => ({ v, ok: !document.getElementById('error').hidden && /0 to 9999/.test(document.getElementById('error-text').textContent) && document.getElementById('sq-number').value === v && document.getElementById('result').hidden }), v));
    }
    check(badLinks.every(b => b.ok), `a link with a wrong number (?id=${badLinks.map(b => `${b.v || '(empty)'}${b.ok ? '' : ' ✗'}`).join(', ')}) keeps it in the field and says: “${await p.textContent('#error-text')}”`);
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => [...document.querySelectorAll('#examples img')].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
    await shot('landing');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll on the landing');
    const fold = await p.evaluate(() => ({ go: Math.round(document.querySelector('.go').getBoundingClientRect().bottom), h: innerHeight }));
    check(fold.go <= fold.h, `the Squiggle # field and Build button are on the first screen (bottom at ${fold.go} of ${fold.h} px)`);
    check((await p.locator('#examples button').count()) === 5, 'five example Squiggles with Art Blocks thumbnails');
    const hero = await p.evaluate(() => { const i = document.querySelector('.hero-pic img').getBoundingClientRect(), h = document.querySelector('.hero h1').getBoundingClientRect(); return { top: Math.round(i.top), bottom: Math.round(i.bottom), below: i.top > h.bottom, word: document.querySelector('.brand').innerText.trim() }; });
    check(hero.bottom <= fold.h && (hero.below || dev === 'desktop') && !hero.word, `a brick picture ${dev === 'mobile' ? 'under' : 'beside'} the title on the first screen (${hero.top}–${hero.bottom} px); the header shows the logo mark only, the name is the title`);
    const font = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('sq-number')); return `${s.fontSize} ${s.fontWeight}`; });
    check(font === '30px 800', `the Squiggle # field is set in 30 px bold (${font})`);
    const hist0 = await p.evaluate(() => history.length);
    await p.fill('#sq-number', ''); await p.type('#sq-number', '10000'); await p.click('.go'); await p.waitForTimeout(600);
    const long = await p.inputValue('#sq-number'), longErr = await p.isVisible('#error') && /0 to 9999/.test(await p.textContent('#error-text')) && !p.url().includes('id=');
    await p.fill('#sq-number', '12a'); await p.click('.go'); await p.waitForTimeout(900);
    const errAt = await p.evaluate(() => { const e = document.getElementById('error').getBoundingClientRect(), f = document.querySelector('.num-row').getBoundingClientRect(); return { top: Math.round(e.top), bottom: Math.round(e.bottom), under: e.top - f.bottom, h: innerHeight }; });
    check(long === '10000' && longErr && await p.isVisible('#error') && /0 to 9999/.test(await p.textContent('#error-text')) && !p.url().includes('id='), `10000 stays whole and is refused (never cut to #1000); 12a → “${await p.textContent('#error-text')}”, nothing loads`);
    check(errAt.under >= 0 && errAt.under < 60 && errAt.bottom <= errAt.h, `the error shows right under the field, on screen (${errAt.top}–${errAt.bottom} of ${errAt.h} px, ${Math.round(errAt.under)} px below the field)`);
    await shot('error-number');
    await p.fill('#sq-number', ''); await p.type('#sq-number', '#7583');
    const typed = await p.inputValue('#sq-number');
    await p.fill('#sq-number', '#7583');
    check(typed === '7583' && await p.inputValue('#sq-number') === '7583', `“#7583” typed or pasted → the field keeps ${typed} (the # is already shown)`);

    // 2. type 1234 → the original, then the Frame builds
    const t0 = Date.now();
    await p.fill('#sq-number', String(ID)); await p.click('.go');
    await p.waitForFunction(() => !document.getElementById('orig-img').hidden && document.getElementById('orig-img').naturalWidth > 0, null, { timeout: 60000 });
    const tOriginal = Date.now() - t0;
    await p.waitForFunction(() => window.stb?.model, null, { timeout: 90000 });
    const tModel = Date.now() - t0;
    log(`  original after ${tOriginal} ms, first model after ${tModel} ms · URL ${p.url()}`);
    check(await p.evaluate(() => window.stb.loaded.origin === 'script'), `origin: ${await p.evaluate(() => window.stb.loaded.origin)} (its own script)`);
    check((await p.textContent('#orig-title')) === `Chromie Squiggle #${ID}`, 'the original is titled Chromie Squiggle #1234');
    const cut = () => p.evaluate(() => [...document.querySelectorAll('#features dd')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 0.5).map(e => e.textContent));
    log(`  features: ${(await p.locator('#features div').allInnerTexts()).map(t => t.replace('\n', ' ')).join(' · ')}`);
    await p.waitForTimeout(3000);
    const mid = await state();
    check(mid.playing && mid.t > 1, `the Frame builds: playing, ${mid.t?.toFixed(1)} s into the animation`);
    await shot('frame-building');
    const early = await p.textContent('#scales');
    await p.waitForFunction(() => !document.getElementById('hint').hidden, null, { timeout: 30000 });
    const done = await state();
    const chips = () => p.evaluate(() => ['replay', 'skip', 'reset'].filter(id => !document.getElementById(id).hidden).join(', '));
    const chipsDone = await chips();
    check(chipsDone === 'replay' && !/studs/.test(early), `after the build: chips ${chipsDone} (no Skip, no Reset view yet) · sizes before the other one is built: ${early.replace(/\s+/g, ' ')}`);
    const vb = await p.locator('#view').boundingBox(), cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    if (dev === 'mobile') await touchDrag(p, cx - 60, cy, cx + 60, cy + 10);
    else { await p.mouse.move(cx - 60, cy); await p.mouse.down(); await p.mouse.move(cx + 60, cy + 10, { steps: 8 }); await p.mouse.up(); }
    await p.waitForTimeout(400);
    const chipsMoved = await chips();
    await p.click('#reset'); await p.waitForTimeout(900);
    check(chipsMoved === 'replay, reset' && await chips() === 'replay', `a drag shows “Reset view” (${chipsMoved}), which goes away once used (${await chips()})`);
    check(!done.playing && done.format === 'relief' && done.display === 'frame' && done.scale === 'large', `the animation ends on the Large Frame (${done.pieces} pieces)`);
    log(`  ${done.sub} · ${done.stats.join(' | ')}`);
    await p.waitForFunction(() => [...document.querySelectorAll('.disp img')].every(i => !i.hidden), null, { timeout: 60000 });
    log(`  display cards: ${(await p.locator('.disp').allInnerTexts()).map(t => t.replace(/\n/g, ' ')).join(' | ')}`);
    await shot('frame-built', '#sec-model');
    const stageFit = await p.evaluate(() => { const v = document.getElementById('view').getBoundingClientRect(), r = document.getElementById('replay').getBoundingClientRect(); return { ar: v.width / v.height, clear: r.top >= v.bottom || innerWidth >= 900 }; });
    if (dev === 'mobile') check(stageFit.ar > 1.8 && stageFit.clear, `the stage takes the Frame's shape (${stageFit.ar.toFixed(2)}:1), its chips in a bar under it`);
    check(await p.evaluate(() => document.getElementById('pill').textContent.includes('solid')), `checks: ${await p.textContent('#pill')} · ${await p.textContent('#status-short')}`);
    const row = await p.evaluate(() => { const r = [...document.querySelectorAll('.tools > *')].map(e => e.getBoundingClientRect()); return { one: Math.max(...r.map(x => x.top)) < Math.min(...r.map(x => x.bottom)), n: r.length }; });
    if (dev === 'desktop') check(row.one, `the ${row.n} tools under the model sit on one row`);
    if (dev === 'desktop') {
      const nav = await p.evaluate(() => { const a = document.getElementById('secnav').getBoundingClientRect(), b = document.getElementById('sec-model').getBoundingClientRect(); return [a.left - b.left, a.right - b.right].map(Math.round); });
      check(nav[0] === 0 && nav[1] === 0, `the section menu lines up with the sections (edges ${nav.join(', ')} px off)`);
    }

    // 3. the other models
    const cutFigures = new Set(done.cut);
    for (const [name, act, want] of [
      ['floating', () => p.click('.disp[data-display="floating"]'), { format: 'relief', display: 'floating', scale: 'large' }],
      ['backdrop', () => p.click('.disp[data-display="backdrop"]'), { format: 'relief', display: 'backdrop', scale: 'large' }],
      ['backdrop-small', () => p.click('[data-scale="small"]'), { format: 'relief', display: 'backdrop', scale: 'small' }],
      ['mosaic', () => p.click('[data-format="mosaic"]'), { format: 'mosaic', scale: 'large' }],
      ['mosaic-small', () => p.click('[data-scale="small"]'), { format: 'mosaic', scale: 'small' }],
      ['frame-again', async () => { await p.click('[data-format="relief"]'); await p.click('[data-scale="large"]'); await p.click('.disp[data-display="frame"]'); }, { format: 'relief', display: 'frame', scale: 'large' }],
    ]) {
      await act(); await settle(want);
      await p.waitForTimeout(1200);
      const s = await state();
      if (name !== 'frame-again' && await p.isVisible('#skip')) { await p.click('#skip'); await p.waitForTimeout(700); }
      log(`  ${name}: ${s.sub} · ${s.stats.join(' | ')}${s.playing ? ' · animating' : ''}`);
      s.cut.forEach(c => cutFigures.add(`${name}: ${c}`));
      if (['floating', 'backdrop', 'mosaic'].includes(name) || (dev === 'desktop' && name !== 'frame-again')) await shot(name, '.duo');
    }
    check((await state()).display === 'frame', 'back to the Large Frame');
    check(!cutFigures.size, `the key figures fit their cards on every model${cutFigures.size ? `: ${[...cutFigures].join(', ')}` : ''}`);
    check(await p.evaluate(() => !/socle/i.test(document.getElementById('checks').textContent + document.querySelector('.faq').textContent)), 'the checks and the FAQ say “base”, not “socle”');

    // 4. More info
    await p.click('#more summary');
    await p.waitForTimeout(300);
    log(`  more info: ${(await p.locator('#checks li').allInnerTexts()).map(t => t.replace('\n', ' ')).join(' · ')}`);
    log(`  rules: ${(await p.locator('#rules li b').allInnerTexts()).join(', ')} · notes ${await p.locator('#notes li').count()}`);
    await shot('more-info', '#more');

    // 5. the reader
    await p.locator('#sec-manual').scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    await p.click('#pg-next'); await p.waitForTimeout(400); await p.click('#pg-next'); await p.waitForTimeout(400);
    const after2 = await p.textContent('#pg-label');
    const first = await p.evaluate(() => window.stb.maker.firstStep);
    await p.locator('#pg-range').fill(String(first + 2)); await p.waitForTimeout(1500);
    const step = await p.textContent('#pg-label');
    check(/Step 3 of \d+/.test(step), `reader: ${await p.textContent('#manual-sub')} · after 2 × next: ${after2} · slider to page ${first + 2}: ${step}`);
    const drawn = await p.evaluate(() => [...document.querySelectorAll('#thumbs canvas')].filter(c => c.getContext('2d').getImageData(112, 60, 1, 1).data[3] > 0).length);
    log(`  thumbnails drawn so far (lazily): ${drawn} of ${await p.locator('#thumbs button').count()}`);
    await shot('reader', '#sec-manual');
    const arrows = await p.evaluate(() => { const c = document.getElementById('page-canvas').getBoundingClientRect(); return ['pg-prev', 'pg-next'].filter(id => { const a = document.getElementById(id).getBoundingClientRect(); return !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom); }); });
    check(!arrows.length, `the reader's ‹ › arrows sit off the page (${dev === 'mobile' ? 'under it, with the slider' : 'in its margins'})${arrows.length ? `: ${arrows.join(', ')} on it` : ''}`);
    await p.locator('#pg-range').fill(String(await p.evaluate(() => window.stb.maker.total - 2))); await p.waitForTimeout(1500);
    await shot('reader-late-page', '#page-view');
    log(`  late page: ${await p.textContent('#pg-label')}`);
    if (dev === 'mobile') {
      const before = await p.textContent('#pg-label'), pb = await p.locator('#page-view').boundingBox();
      await touchDrag(p, pb.x + pb.width * 0.8, pb.y + pb.height / 2, pb.x + pb.width * 0.2, pb.y + pb.height / 2 + 8);
      await p.waitForTimeout(800);
      const after = await p.textContent('#pg-label');
      check(after !== before, `a swipe on the page turns it: ${before} → ${after}`);
    }

    // 6. downloads from ① and ②
    const files = {}, m = await p.evaluate(() => ({ total: window.stb.maker.total, pieces: window.stb.model.pieces.length, lots: window.stb.model.bom.length }));
    files.pdf = await dl(() => p.click('#dl-pdf'));
    const pdf = fs.readFileSync(files.pdf.file, 'latin1'), pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    check(pdf.startsWith('%PDF') && pages === m.total, `PDF ${files.pdf.name}: ${(files.pdf.size / 1e6).toFixed(1)} MB, ${pages} pages (reader: ${m.total})`);
    files.kit = await dl(() => p.click('#dl-kit'));
    const list = execSync(`unzip -Z1 "${files.kit.file}"`).toString().trim().split('\n');
    check(['-instructions.pdf', '-parts.csv', '-pick-a-brick.csv', '-bricklink.xml', '-nameplate.png', '-nameplate-cut-marks.png', '-share.png', 'README.txt'].every(s => list.some(f => f.endsWith(s))), `kit ${files.kit.name}: ${(files.kit.size / 1e6).toFixed(1)} MB · ${list.join(', ')}`);
    files.nameplate = await dl(() => p.click('#dl-nameplate'));
    const np = pngSize(files.nameplate.file);
    check(np && np[0] > 1000, `nameplate ${files.nameplate.name}: PNG ${np?.join(' × ')} px (600 dpi, with cut marks)`);
    files.share = await dl(() => p.click('#dl-share'));
    const sh = pngSize(files.share.file);
    check(sh && sh[0] === 1200 && sh[1] === 630, `share image ${files.share.name}: PNG ${sh?.join(' × ')}`);
    if (!flag('no-video')) for (const [id, what] of [['vid-square', 'square'], ['vid-story', '9:16']]) {
      await p.locator('#sec-model').scrollIntoViewIfNeeded();
      const t = Date.now();
      const v = files[what] = await dl(() => p.click('#' + id), 180000);
      let info = '';
      if (has('ffprobe')) {
        const j = JSON.parse(execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${v.file}"`).toString());
        const vs = j.streams.find(s => s.codec_type === 'video'), as = j.streams.find(s => s.codec_type === 'audio');
        info = `${(+j.format.duration).toFixed(1)} s, ${vs.codec_name} ${vs.width}×${vs.height}, audio ${as ? as.codec_name : 'none'}`;
        check(+j.format.duration > 18 && !!as && (what === 'square' ? vs.width === vs.height : vs.height > vs.width), `video ${v.name}: ${info}, ${(v.size / 1e6).toFixed(1)} MB, recorded in ${((Date.now() - t) / 1000).toFixed(0)} s`);
      } else check(v.size > 1e6, `video ${v.name}: ${(v.size / 1e6).toFixed(1)} MB`);
    }
    const share = await p.evaluate(() => { document.getElementById('share-x').dispatchEvent(new PointerEvent('pointerdown')); return document.getElementById('share-x').href; });
    check(/x\.com\/intent\/post\?text=.*1234.*Squiggle%20to%20Bricks/.test(share), `Share on X: ${decodeURIComponent(share).slice(0, 110)}…`);

    // 7. buy the bricks
    await p.locator('#sec-buy').scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
    log(`  shopping list: ${await p.textContent('#shop-sum')} · ${(await p.locator('#subtot .st').allInnerTexts()).map(t => t.replace(/\n/g, ' ')).join(' | ')} · lots drawn ${await p.locator('.lot').count()}`);
    const names = await p.evaluate(() => [...document.querySelectorAll('.lot small:first-of-type')].map(e => e.textContent));
    const cutNames = await p.evaluate(() => [...document.querySelectorAll('.lot small')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > e.closest('.lot').getBoundingClientRect().right + 1).map(e => e.textContent));
    check(!cutNames.length && names.some(n => /^Technic Brick 1×\d+$/.test(n)), `every part name shown in full (${names.filter(n => /Technic/.test(n)).slice(0, 2).join(', ')}…)${cutNames.length ? `, cut: ${cutNames.join(', ')}` : ''}`);
    const grams = await p.evaluate(() => [...document.querySelectorAll('#stats, #subtot, .shop-sec')].map(e => e.innerText).join(' ').match(/\d+ g\b/g) ?? []);
    check(!/part numbers/.test(await p.textContent('#shop-sum')) && names.every(n => !/\d x \d/.test(n)) && grams.every(g => parseInt(g) % 10 === 0),
      `shopping list: “${await p.textContent('#shop-sum')}”, names like “${names[0]}”, weights rounded to 10 g as in the booklet (${grams.join(', ') || 'all in kg'})`);
    const tools = (await p.locator('.tools .tool small').allInnerTexts()).map(t => t.replace(/\n/g, ' · '));
    check(tools.every(t => t.startsWith('Download')), `the tool buttons say they download: ${tools.join(' | ')}`);
    await shot('buy', '#sec-buy');
    const [pab] = await Promise.all([p.waitForEvent('download'), (async () => {
      await p.click('#buy-lego');
      await p.waitForSelector('#before-order[open]');
      const agree = await p.evaluate(() => document.querySelector('.agree').getBoundingClientRect().height);
      check(await p.isDisabled('#bo-continue') && agree >= 40, `Before you order: Continue is off until "I understand" is ticked (its label ${agree.toFixed(0)} px tall)`);
      await shot('before-you-order');
      await p.check('#bo-ok'); await p.click('#bo-continue');
    })()]);
    const pabFile = path.join(OUT, `${dev}-${pab.suggestedFilename()}`); await pab.saveAs(pabFile);
    const pabText = fs.readFileSync(pabFile, 'utf8'), expected = await p.evaluate(async () => (await import('/src/squiggle/exports.ts')).pickABrickFiles(window.stb.model));
    check(expected.length === 1 && pabText === expected[0] && pabText.startsWith('elementId,quantity\r\n') && !pabText.endsWith('\n') && !/[^\r]\n/.test(pabText),
      `Pick a Brick ${pab.suggestedFilename()}: exact bytes, CRLF, no trailing newline, ${pabText.split('\r\n').length - 1} lines, ${pabText.split('\r\n').slice(1).reduce((a, l) => a + +l.split(',')[1], 0)} pieces (model ${m.pieces})`);
    await p.waitForSelector('#lego-guide:not([hidden])');
    check(await p.evaluate(() => [...document.querySelectorAll('#lego-guide img')].every(i => i.complete && i.naturalWidth > 0)), `LEGO guide open with its 2 screenshots · ${await p.textContent('#lego-file')}`);
    await shot('lego-guide', '#lego-guide');
    await p.click('#buy-bl'); await p.waitForSelector('#bl-after:not([hidden])');
    const clip = await p.evaluate(() => navigator.clipboard.readText()), xml = await p.evaluate(async () => (await import('/src/squiggle/exports.ts')).brickLinkXML(window.stb.model));
    const blPieces = [...clip.matchAll(/<MINQTY>(\d+)<\/MINQTY>/g)].reduce((a, x) => a + +x[1], 0);
    check(clip === xml && blPieces === m.pieces, `BrickLink: ${await p.textContent('#bl-after-text')} · clipboard = the XML, ${[...clip.matchAll(/<ITEM>/g)].length} items, ${blPieces} pieces`);
    const after = await p.evaluate(() => ({ link: document.querySelector('#bl-after a').textContent, text: document.getElementById('bl-after').innerText }));
    check(after.link.endsWith('↗') && !after.text.trim().endsWith('↗'), `the external-link arrow is on the link: “${after.text}”`);
    await shot('bricklink-copied', '.ctas');
    await p.click('.howorder summary');
    files.csv = await dl(() => p.click('#dl-csv'));
    const csv = fs.readFileSync(files.csv.file, 'utf8').trim().split('\r\n');
    check(csv[0].startsWith('Section,BrickLink part') && csv.at(-1).startsWith('TOTAL') && +csv.at(-1).split(',')[5] === m.pieces, `parts list ${files.csv.name}: ${csv.length - 2} lots, TOTAL ${csv.at(-1).split(',')[5]} pieces`);
    files.xml = await dl(() => p.click('#dl-xml'));
    check(fs.readFileSync(files.xml.file, 'utf8') === xml, `BrickLink file ${files.xml.name}: same as the copied list`);
    files.pab2 = await dl(() => p.click('#dl-pab'));
    check(fs.readFileSync(files.pab2.file, 'utf8') === pabText, `LEGO list again from "How ordering works": ${files.pab2.name}, same bytes`);

    // 8. the whole page, then what left the browser
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll with a model shown');
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
    await shot('full-page').then(() => p.screenshot({ path: `${OUT}/${dev}-full.png`, fullPage: true }));
    if (dev === 'desktop') fs.writeFileSync(`${OUT}/upload-${ID}.png`, Buffer.from((await p.evaluate(() => window.stb.loaded.original)).split(',')[1], 'base64'));
    if (dev === 'desktop' && flag('docs')) {
      await p.click('#more summary');   // folds "More info" again (opened in 4.)
      await snap('#sec-model', 'docs/squiggle.png');
      await snap('#sec-manual', 'docs/instructions.png');
      await snap('#sec-buy', 'docs/buy.png');
    }
    // the section menu: fits the screen, scrolls without history entries
    const nav = await p.evaluate(() => { const n = document.getElementById('secnav'); return { client: n.clientWidth, scroll: n.scrollWidth, labels: [...n.querySelectorAll('a')].map(a => a.innerText.replace(/\n/g, ' ')) }; });
    const h1 = await p.evaluate(() => history.length);
    const landed = id => p.waitForFunction(id => { const t = document.getElementById(id).getBoundingClientRect().top; return t >= 0 && t < 130; }, id, { timeout: 4000 }).catch(() => {});
    for (const s of ['sec-buy', 'sec-manual', 'sec-model']) { await p.click(`#secnav a[data-sec="${s}"]`); await landed(s); await p.waitForTimeout(300); }
    const navTop = await p.evaluate(() => Math.round(document.getElementById('sec-model').getBoundingClientRect().top));
    check(nav.scroll <= nav.client && await p.evaluate(h => history.length === h && !location.hash, h1) && navTop >= 0 && navTop < 130,
      `section menu: ${nav.labels.join(' · ')} fits (${nav.scroll}/${nav.client} px), its links scroll (section 1 at ${navTop} px) and add no history entry`);
    if (dev === 'mobile') {   // tap sizes on the phone (links inside running text excepted)
      await p.evaluate(() => { document.querySelector('.howorder').open = true; document.getElementById('lego-guide').hidden = false; document.getElementById('reset').hidden = false; document.getElementById('skip').hidden = false; });
      const small = await p.evaluate(() => ['#replay', '#skip', '#reset', '#secnav a', '#pg-prev', '#pg-next', '#pg-range', '#shop-more', '.faq summary', '.howorder summary', '#dl-pab', '#dl-xml', '#dl-csv', '#lego-again', '#sq-number', 'a.brand', '#share-x', '.go-lego', '#upload-link', '#orig-link', '.foot .links a', '.go', '.tool', '.seg button', '#examples button', '.disp']
        .flatMap(s => [...document.querySelectorAll(s)].map(e => [s, +e.getBoundingClientRect().height.toFixed(1)])).filter(([, h]) => h < 40));
      await p.evaluate(() => { document.querySelector('.howorder').open = false; document.getElementById('lego-guide').hidden = true; document.getElementById('reset').hidden = true; document.getElementById('skip').hidden = true; });
      check(!small.length, `every control is at least 40 px tall on the phone${small.length ? `: ${small.map(([s, h]) => `${s} ${h} px`).join(', ')}` : ''}`);
    }
    // a second Squiggle from the examples, then Back and Forward
    await p.evaluate(() => scrollTo(0, 0));
    await p.locator('#examples button').nth(1).click();
    await p.waitForFunction(() => window.stb?.loaded?.id === 7583 && window.stb.model && document.getElementById('busy').hidden, null, { timeout: 90000 });
    const onScreen = () => p.evaluate(() => ({ id: window.stb.loaded?.id ?? null, url: location.search, result: !document.getElementById('result').hidden }));
    const second = await onScreen();
    const cut7583 = await cut();
    check(!cut7583.length && await p.evaluate(() => [...document.querySelectorAll('#features dd')].some(e => e.textContent === 'Perfect Spectrum' && e.offsetParent)), `#7583's features in full (Spectrum: Perfect Spectrum)${cut7583.length ? `, cut: ${cut7583.join(', ')}` : ''}`);
    await p.goBack();
    await p.waitForFunction(() => window.stb?.loaded?.id === 1234 && window.stb.model && document.getElementById('busy').hidden, null, { timeout: 90000 }).catch(() => {});
    const back = await onScreen();
    await p.goBack(); await p.waitForTimeout(800);
    const landing = await onScreen();
    await p.goForward();
    await p.waitForFunction(() => window.stb?.loaded?.id === 1234 && window.stb.model && document.getElementById('busy').hidden, null, { timeout: 90000 }).catch(() => {});
    const fwd = await onScreen();
    check(second.url === '?id=7583' && back.id === 1234 && back.url === '?id=1234' && !landing.result && landing.url === '' && fwd.id === 1234 && fwd.url === '?id=1234' && await p.evaluate(h => history.length === h + 2, hist0),
      `history: #7583 (${second.url}) → Back #${back.id} (${back.url}) → Back the landing (${landing.result ? 'result shown' : 'no result'}) → Forward #${fwd.id} (${fwd.url}), one entry per Squiggle`);
    log(`  hosts: ${[...hosts].join(', ')}`);
    check(!errs.length, `page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
    summary[dev] = { tOriginal, tModel, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.name])) };
    await ctx.close();
  }

  // 9. fallbacks and the upload (desktop), phone speed (mobile, CPU 6× slower)
  if (!opt('only') || opt('only') === 'desktop') {
    log('\n===== fallbacks =====');
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => fail.push('pageerror ' + e.message));
    {   // Art Blocks unreachable: the example thumbnails are drawn here from their hashes
      const q = await ctx.newPage();
      await q.route(u => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), r => r.abort());
      await q.goto(BASE, { waitUntil: 'networkidle' }); await q.waitForTimeout(1000);
      const ex = await q.evaluate(() => [...document.querySelectorAll('#examples img')].filter(i => i.src.startsWith('data:') && i.naturalWidth > 0 && i.style.visibility !== 'hidden').length);
      check(ex === 5, `Art Blocks unreachable: ${ex} of 5 example thumbnails drawn from their hashes`);
      await q.locator('.examples').screenshot({ path: `${OUT}/fallback-examples-offline.png` });
      await q.close();
    }
    {   // Art Blocks hangs (no answer, no error): after 6 s the thumbnails are drawn here too
      const q = await ctx.newPage();
      await q.route(u => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), () => {});
      await q.goto(BASE, { waitUntil: 'domcontentloaded' });
      const drawn = () => q.evaluate(() => [...document.querySelectorAll('#examples img')].filter(i => i.src.startsWith('data:') && i.naturalWidth > 0 && i.style.visibility !== 'hidden').length);
      await q.waitForTimeout(3000); const early = await drawn();
      await q.waitForFunction(() => [...document.querySelectorAll('#examples img')].every(i => i.naturalWidth > 0), null, { timeout: 12000 }).catch(() => {});
      const ex = await drawn();
      check(early === 0 && ex === 5, `Art Blocks hanging: ${ex} of 5 example thumbnails drawn from their hashes after the 6 s wait`);
      await q.close();
    }
    for (const [q, want] of [['generator', 'port'], ['token,generator', 'image']]) {
      await p.goto(`${BASE}?fail=${q}&id=${ID}`);
      await p.waitForFunction(() => window.stb?.model && document.getElementById('busy').hidden, null, { timeout: 90000 });
      const s = await p.evaluate(() => ({ origin: window.stb.loaded.origin, pieces: window.stb.model.pieces.length, origin_text: document.getElementById('orig-origin').textContent, pill: document.getElementById('pill').textContent }));
      check(s.origin === want, `?fail=${q}: origin ${s.origin} · ${s.pieces} pieces · ${s.pill} · “${s.origin_text}”`);
      const est = await p.evaluate(() => !document.getElementById('feat-est').hidden && document.getElementById('feat-est').textContent);
      check(want === 'image' ? est === 'Estimated from Art Blocks’ picture' : est === false, `features: ${est ? `“${est}”` : 'Art Blocks’ own'}`);
      if (await p.isVisible('#skip')) { await p.click('#skip'); await p.waitForTimeout(600); }
      await p.locator('.duo').screenshot({ path: `${OUT}/fallback-${want}.png` });
    }
    await p.goto(`${BASE}?fail=token,generator,image&id=${ID}`);
    await p.waitForSelector('#error:not([hidden])', { timeout: 60000 });
    const err = await p.textContent('#error-text');
    check(/upload an image/i.test(err) && await p.isVisible('#error-upload') && await p.isHidden('#result'), `?fail=token,generator,image: “${err}” with an Upload button`);
    await p.locator('#input-panel').screenshot({ path: `${OUT}/fallback-error.png` });
    await p.setInputFiles('#file2', `${OUT}/upload-${ID}.png`);
    await p.waitForFunction(() => window.stb?.model && document.getElementById('busy').hidden, null, { timeout: 90000 });
    const u = await p.evaluate(() => ({ origin: window.stb.loaded.origin, id: window.stb.loaded.id, pieces: window.stb.model.pieces.length, title: document.getElementById('orig-title').textContent, pill: document.getElementById('pill').textContent, type: window.stb.loaded.features.Type }));
    check(u.origin === 'upload' && u.id === null && /solid/.test(u.pill), `upload: origin ${u.origin}, “${u.title}”, type ${u.type}, ${u.pieces} pieces, ${u.pill}`);
    const est = await p.evaluate(() => ({ note: !document.getElementById('feat-est').hidden && document.getElementById('feat-est').textContent, style: document.getElementById('features').classList.contains('est') }));
    check(est.note === 'Estimated from your picture' && est.style, `the features read from the picture are labelled “${est.note}”, in their own style`);
    if (await p.isVisible('#skip')) { await p.click('#skip'); await p.waitForTimeout(600); }
    await p.locator('.duo').screenshot({ path: `${OUT}/fallback-upload.png` });
    const up = await Promise.all([p.waitForEvent('download'), p.click('#dl-share')]).then(([d]) => d.suggestedFilename());
    check(/^squiggle-upload-frame-large-share\.png$/.test(up), `upload downloads are named ${up}`);
    await ctx.close();
  }
  if (!opt('only') || opt('only') === 'mobile') {
    log('\n===== phone speed (CPU 6× slower, no workers) =====');
    const ctx = await b.newContext({ ...devices.mobile, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
    const p = await ctx.newPage();
    // CPU throttling reaches the page, not its workers: without Worker the builds run on the (throttled) main thread
    await p.addInitScript(() => { delete window.Worker; });
    await p.goto(BASE, { waitUntil: 'networkidle' });
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const t = await p.evaluate(async id => {
      const t0 = performance.now();
      let tLoaded = 0;
      const img = document.getElementById('orig-img');
      new MutationObserver(() => { if (!tLoaded && !img.hidden) tLoaded = performance.now(); }).observe(img, { attributes: true });
      document.getElementById('sq-number').value = String(id);
      document.querySelector('.go').click();
      await new Promise(r => { const f = () => (window.stb?.model ? r() : setTimeout(f, 50)); f(); });
      const t1 = performance.now();
      return { load: tLoaded - t0, total: t1 - t0, build: t1 - tLoaded };
    }, ID);
    check(t.build < 15000, `phone, CPU 6×: Squiggle fetched and redrawn in ${(t.load / 1000).toFixed(1)} s, then the first model built on the main thread in ${(t.build / 1000).toFixed(1)} s (budget 15 s), ${(t.total / 1000).toFixed(1)} s in all`);
    summary.phone = t;
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/flow.json`, JSON.stringify({ summary, failed: fail }, null, 1));
  log(`\n${fail.length ? `${fail.length} FAILED:\n- ${fail.join('\n- ')}` : 'All checks passed.'} Screenshots in ${OUT}/`);
  process.exit(fail.length ? 1 : 0);
})();
