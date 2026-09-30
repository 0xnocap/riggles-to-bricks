// Records the Squiggle video through the stage lab page (dev/stage.html) in Chrome,
// saves it, reads it back (duration, size, audio track, frames drawn from the <video>
// at several times) and checks it: 20–25 s, the expected size, clicks on the
// soundtrack, picture and sound of the same length (within 0.1 s: a picture that
// stalled or ended early would leave them apart), the bit rate, no hitch in the
// moving picture (no two pictures over 0.1 s apart, by the recorder and in the file),
// the model clear of the titles and the original's card while they show (from the
// video's own camera path), and a first frame (the preview apps show) that is the
// finished model, like the end, and the studio's grey as drawn (not washed out by a
// colour range flagged wrong). --busy s:ms,… blocks the page for ms at s seconds into
// the first take (a visitor switching models meanwhile): the hitches must bring a
// smooth retake. Needs the dev server (npx vite --port 5180).
//   node scripts/video-check.cjs [id=1234] [mode=frame-large] [formats=square,story] [--small] [--port 5180] [--out out] [--busy 4:200,6.8:130]
//   → <out>/video-<id>-<mode>-<format>.{mp4|webm}, <out>/video-frames/<id>-<mode>-<format>-<n>.jpg, <out>/video-frames/sheet-<id>-<mode>.jpg
const { chromium } = require('playwright-core');
const { exe } = require('./shot.cjs');
const { execFileSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const flag = k => { const i = args.indexOf('--' + k); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const small = flag('small'), port = opt('port', '5180'), outDir = opt('out', 'out');
const busy = (opt('busy', '') || '').split(',').filter(Boolean).map(v => v.split(':').map(Number));
const [id = '1234', mode = 'frame-large', formats = 'square,story'] = args;
// seconds: mid-dissolve, the empty panel or base, then fractions of the duration (negative: before the end)
const AT = [0, 0.9, 1.5, 0.3, 0.55, 0.72, 0.79, -0.3];
const at = d => AT.map((v, i) => (i < 3 ? v : v < 0 ? v : v * d));
// Mbit/s at most (picture and sound): 1080 square, 1080 × 1920, the small variants
const MAX_RATE = { square: 4.9, story: 5.8, small: 3.1 };
// s: the longest wait between two moving pictures (video.ts STALL); px the model keeps from the titles and the card
const STALL = 0.1, ROOM = 8;
// the studio's grey (stage.ts STAGE_BG), in the picture's top left corner
const BG = [0xe8, 0xe9, 0xeb];
// the page must not reload while it records (other files may change under the dev server): no HMR client
const HMR_STUB = 'export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, invalidate() {}, on() {}, off() {}, send() {}, data: {} }); export const updateStyle = () => {}; export const removeStyle = () => {}; export const injectQuery = u => u; export class ErrorOverlay {}';

function ffprobe(file) {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,channels,sample_rate,duration', '-of', 'json', file]).toString());
    const len = t => { const s = j.streams.find(s => s.codec_type === t); return s && s.duration !== undefined ? +s.duration : null; };
    return { duration: +j.format.duration, video: len('video'), audio: len('audio'), streams: j.streams.map(s => s.codec_type === 'video' ? `video ${s.codec_name} ${s.width}×${s.height}` : `${s.codec_type} ${s.codec_name} ${s.channels ?? ''}ch ${s.sample_rate ?? ''}`) };
  } catch (e) { return null; }
}

/** [r, g, b] of the file's picture at t s, px (x, y), as ffmpeg decodes it (its colour range flag applied) */
function pixel(file, t, x, y) {
  try { return [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)]; } catch (e) { return null; }
}

/** the video's frame times in the file (s, sorted) */
function frameTimes(file) {
  try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]).toString().split('\n').filter(Boolean).map(Number).sort((a, b) => a - b); } catch (e) { return null; }
}

(async () => {
  fs.mkdirSync(`${outDir}/video-frames`, { recursive: true });
  const b = await chromium.launch({ executablePath: exe(), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.route('**/@vite/client', r => r.fulfill({ contentType: 'application/javascript', body: HMR_STUB }));
  await p.goto(`http://localhost:${port}/dev/stage.html`);
  await p.waitForFunction(() => window.stageReady, null, { timeout: 60000 });
  const cells = [];
  let fails = 0;
  for (const format of formats.split(',')) {
    // recordVideo itself (not the lab's wrapper): its stats say how smooth the picture was
    const r = await p.evaluate(async ([id, mode, format, small, busy]) => {
      const [a, s = 'small'] = mode.split('-'), m = a === 'mosaic' ? await sq.build(id, 'mosaic', null, s) : await sq.build(id, 'relief', a, s);
      const fx = await sq.fixture(id), { recordVideo } = await import('/src/squiggle/video.ts'), t = performance.now();
      // --busy: the page blocked at moments of the first take
      let armed = false;
      const onProgress = (stage, f, take) => {
        if (stage !== 'recording' || take !== 1 || armed) return;
        armed = true;
        for (const [at, ms] of busy) setTimeout(() => { const e = performance.now() + ms; while (performance.now() < e); }, at * 1000);
      };
      const v = await recordVideo(m, { id: fx.id, original: await sq.original(id, 900) }, { format, small, onProgress });
      return { url: URL.createObjectURL(v.blob), ext: v.ext, bytes: v.blob.size, type: v.blob.type, duration: v.duration, stats: v.stats, ms: Math.round(performance.now() - t) };
    }, [+id, mode, format, small, busy]);
    // the video's own camera path: how close the model comes to the titles and the card while they show
    const fr = await p.evaluate(async ([id, mode, format, small, room]) => {
      const [a, s = 'small'] = mode.split('-'), m = a === 'mosaic' ? await sq.build(id, 'mosaic', null, s) : await sq.build(id, 'relief', a, s);
      const fx = await sq.fixture(id), V = await import('/src/squiggle/video.ts');
      const img = new Image(); img.src = await sq.original(id, 900); await img.decode();
      const st = V.videoStage(m, { format, small });
      try {
        const plan = V.planVideo(st, m, { id: fx.id }, img, { format, small }), k = small ? 2 / 3 : 1;
        const grow = ([x0, y0, x1, y1]) => [x0 - room * k, y0 - room * k, x1 + room * k, y1 + room * k];
        const boxes = { title: plan.toView(grow(plan.boxes.title)), card: plan.boxes.card && plan.toView(grow(plan.boxes.card)) };
        const worst = { title: [-Infinity, 0], card: [-Infinity, 0] }, fading = { title: [-Infinity, 0], card: [-Infinity, 0] };
        for (let i = 0; i <= plan.duration * 30; i++) {
          const t = i / 30, al = plan.alpha(t);
          if (al <= 0) continue;
          const shot = plan.shotAt(t), w = al >= 0.99 ? worst : fading;
          for (const b of ['title', 'card']) { const r = boxes[b] ? st.reach(shot, boxes[b]) : -Infinity; if (r > w[b][0]) w[b] = [r, t]; }
        }
        return { worst, fading, times: plan.times, band: [plan.W, plan.H] };
      } finally { st.dispose(); }
    }, [+id, mode, format, small, ROOM]);
    const file = `${outDir}/video-${id}-${mode}-${format}${small ? '-small' : ''}.${r.ext}`;
    fs.writeFileSync(file, Buffer.from(await p.evaluate(url => sq.base64(url), r.url), 'base64'));
    const pr = await p.evaluate(([url, at]) => sq.probe(url, at), [r.url, at(r.duration)]);
    pr.frames.forEach((f, i) => {
      const jpg = `${outDir}/video-frames/${id}-${mode}-${format}${small ? '-small' : ''}-${i + 1}.jpg`;
      fs.writeFileSync(jpg, Buffer.from(f.img.split(',')[1], 'base64'));
      cells.push({ format, t: f.t, img: f.img });
    });
    const k = small ? 2 / 3 : 1, want = [Math.round(1080 * k), Math.round((format === 'story' ? 1920 : 1080) * k)];
    // first frame against the last one (both the finished model from the front, under the titles): mean difference 0–255
    const diff = await p.evaluate(async ([a, b]) => {
      const px = async url => { const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = 96; c.height = Math.round((96 * i.height) / i.width); const x = c.getContext('2d'); x.drawImage(i, 0, 0, c.width, c.height); return x.getImageData(0, 0, c.width, c.height).data; };
      const [u, v] = await Promise.all([px(a), px(b)]);
      let d = 0; for (let i = 0; i < u.length; i += 4) d += Math.abs(u[i] - v[i]) + Math.abs(u[i + 1] - v[i + 1]) + Math.abs(u[i + 2] - v[i + 2]);
      return d / (u.length / 4) / 3;
    }, [pr.frames[0].img, pr.frames[pr.frames.length - 1].img]);
    const ff = ffprobe(file), a = pr.audio, len = ff?.duration || pr.duration, rate = (r.bytes * 8) / len / 1e6, maxRate = small ? MAX_RATE.small : MAX_RATE[format];
    const checks = [
      ['duration 20–25 s', pr.duration >= 20 && pr.duration <= 25, `${pr.duration.toFixed(2)} s (planned ${r.duration.toFixed(2)} s)`],
      ['size', pr.width === want[0] && pr.height === want[1], `${pr.width}×${pr.height}`],
      ['audio track', !a.error && a.channels >= 1 && a.duration > 18 && a.loudWindows > 20, a.error ?? `${a.channels} ch ${a.sampleRate} Hz, ${a.duration.toFixed(1)} s, peak ${a.peak.toFixed(2)}, ${a.loudWindows} click windows`],
      ['file', r.bytes > 200000, `${(r.bytes / 1e6).toFixed(1)} MB ${r.type}, recorded in ${(r.ms / 1000).toFixed(1)} s`],
      [`bit rate ≤ ${maxRate} Mbit/s`, rate <= maxRate, `${rate.toFixed(2)} Mbit/s`],
      ['smooth picture', r.stats.gap <= STALL, `${r.stats.frames} pictures, longest wait while it moves ${(r.stats.gap * 1000).toFixed(0)} ms, ${r.stats.stalls} over ${STALL * 1000} ms, ${r.stats.takes} take(s)`],
      ['opens on the finished model', diff < 12, `first frame vs last: mean difference ${diff.toFixed(1)} / 255`],
    ];
    if (ff) checks.push(['ffprobe', ff.streams.some(s => s.startsWith('video')) && ff.streams.some(s => s.startsWith('audio')), `${ff.duration ? ff.duration.toFixed(2) + ' s · ' : ''}${ff.streams.join(' · ')}`]);
    if (ff && ff.video !== null && ff.audio !== null) checks.push(['picture and sound in step', Math.abs(ff.video - ff.audio) < 0.1, `video ${ff.video.toFixed(2)} s, audio ${ff.audio.toFixed(2)} s`]);
    // the file's frames: waits over STALL while the picture moves (the still opening and end aside; the audio starts
    // 0.05 s into the file)
    const ft = frameTimes(file);
    if (ft) {
      const from = fr.times.intro + 0.05, to = fr.times.tEnd + 0.05, waits = [];
      for (let i = 1; i < ft.length; i++) if (ft[i] > from && ft[i - 1] < to && ft[i] - ft[i - 1] > STALL) waits.push(`${((ft[i] - ft[i - 1]) * 1000).toFixed(0)} ms at ${ft[i - 1].toFixed(2)} s`);
      checks.push(['no hitch in the file', waits.length === 0, `${ft.length} frames, ${waits.length ? waits.join(', ') : `none over ${STALL * 1000} ms while it moves`}`]);
    }
    const bg = [5, pr.duration - 1].map(t => pixel(file, t, 8, 8));
    if (bg.every(Boolean)) checks.push(['colours as drawn', bg.every(c => c.every((v, i) => Math.abs(v - BG[i]) <= 6)), `studio grey ${bg.map(c => `rgb(${c.join(', ')})`).join(' and ')} (drawn rgb(${BG.join(', ')}))`]);
    const near = ([v, t]) => (v > 0 ? `reaches in at ${t.toFixed(1)} s` : 'clear');
    const fade = `while they fade: title ${near(fr.fading.title)}, card ${near(fr.fading.card)}`;
    checks.push([`model ${ROOM} px clear of the titles and the card`, fr.worst.title[0] <= 0 && fr.worst.card[0] <= 0, `title ${near(fr.worst.title)}, card ${near(fr.worst.card)} (${fade})`]);
    console.log(`\n${file}`);
    for (const [name, ok, detail] of checks) { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${name}: ${detail}`); }
  }
  // contact sheet of the frames
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:12px;font:12px system-ui;background:#f3f5f7;color:#1d2b36}.g{display:grid;grid-template-columns:repeat(${AT.length},1fr);gap:8px;align-items:start;margin-bottom:12px}img{width:100%;border-radius:6px;display:block}figure{margin:0}figcaption{color:#5a6b78}</style>
<h3>#${id} · ${mode} · video frames</h3>${formats.split(',').map(f => `<div class="g">${cells.filter(c => c.format === f).map(c => `<figure><img src="${c.img}"><figcaption>${f} · ${c.t.toFixed(1)} s</figcaption></figure>`).join('')}</div>`).join('')}`;
  const q = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await q.setContent(html); await q.waitForTimeout(500);
  const sheet = `${outDir}/video-frames/sheet-${id}-${mode}${small ? '-small' : ''}.jpg`;
  await q.screenshot({ path: sheet, fullPage: true, type: 'jpeg', quality: 85 });
  await b.close();
  console.log(`\n${sheet}\n${fails ? `${fails} check(s) failed` : 'all checks passed'}`);
  process.exitCode = fails ? 1 : 0;
})();
