// Stage lab page: builds a Squiggle model from a fixture and renders it with the
// Stage. Exposes window.sq for scripts (contact sheets, hero shots, build
// filmstrips, the live stage, videos). The builders are loaded on demand, so the
// page works before they exist. ?id=1234&mode=frame-large&live[&ghosts&rotate]: the live stage.
import { checkModel } from '../src/core/check';
import { partId, type Kind, type Piece } from '../src/core/parts';
import { readCurve, type CurveSource } from '../src/squiggle/curve';
import { summarize, type Display, type Format, type Scale, type SqModel } from '../src/squiggle/model';
import { nameplateLines } from '../src/squiggle/nameplate';
import { Stage, type View } from '../src/squiggle/stage';

interface Fixture extends CurveSource { hash: string }
type RenderOpts = { width?: number; height?: number; view?: Partial<View>; type?: string; quality?: number };

const fixtures = new Map<number, Fixture>();
async function fixture(id: number): Promise<Fixture> {
  if (!fixtures.has(id)) {
    const r = await fetch(`/test/fixtures/squiggles/${id}.json`);
    if (!r.ok) throw new Error(`no fixture for #${id}`);
    fixtures.set(id, await r.json());
  }
  return fixtures.get(id)!;
}

// a variable path keeps Vite from resolving the builders before they exist
async function builder(name: 'mosaic' | 'display'): Promise<Record<string, (...a: unknown[]) => SqModel>> {
  const path = `../src/squiggle/${name}.ts`;
  try { return await import(/* @vite-ignore */ path); } catch (e) { throw new Error(`${name}.ts is not available yet (${(e as Error).message})`); }
}

let stage: Stage | null = null;
let lastMs = 0;

async function build(id: number, format: Format, display: Display | null = 'frame', scale: Scale = 'small', opts: Record<string, unknown> = {}): Promise<SqModel> {
  const fx = await fixture(id), curve = readCurve(fx), meta = { id: fx.id, hash: fx.hash, ...opts };
  const mod = await builder(format === 'mosaic' ? 'mosaic' : 'display');
  const t = performance.now();
  const m = format === 'mosaic' ? mod.buildMosaic(curve, scale, meta, opts) : mod.buildRelief(curve, display ?? 'frame', scale, meta, opts);
  lastMs = Math.round(performance.now() - t);
  return m;
}

function render(model: SqModel, o: RenderOpts = {}): string {
  const w = o.width ?? 900, h = o.height ?? 600;
  if (!stage) stage = new Stage(w, h); else stage.setSize(w, h);
  stage.setModel(model, o.view);
  return stage.toDataURL(o.type ?? 'image/jpeg', o.quality ?? 0.9);
}

/** The Art Blocks picture, redrawn from the fixture's circles on white (3:2). */
async function original(id: number, width = 600): Promise<string> {
  const fx = await fixture(id), k = width / fx.width;
  const c = document.createElement('canvas'); c.width = width; c.height = Math.round((width * 2) / 3);
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.lineWidth = Math.max(1, k);
  for (const d of fx.dots as [number, number, number, string | null, string | null][]) {
    x.beginPath(); x.arc(d[0] * k, d[1] * k, (d[2] * k) / 2, 0, Math.PI * 2);
    if (d[3]) { x.fillStyle = d[3]; x.fill(); }
    if (d[4]) { x.strokeStyle = d[4]; x.stroke(); }
  }
  return c.toDataURL('image/jpeg', 0.9);
}

/** Build, render and sum up one model, for contact sheets. */
async function report(id: number, format: Format, display: Display | null, scale: Scale, o: RenderOpts & { opts?: Record<string, unknown> } = {}) {
  try {
    const m = await build(id, format, display, scale, o.opts);
    const img = render(m, o);
    return { ok: true as const, img, ms: lastMs, pieces: m.pieces.length, subtotals: m.subtotals, dims: m.dims, grams: m.grams, cost: m.cost, checks: m.checks, notes: m.notes, lots: m.bom.length, hanging: m.hanging, pose: m.pose };
  } catch (e) { return { ok: false as const, error: (e as Error).message }; }
}

// ---- synthetic models, to see the Stage before the builders land ----

const pc = (kind: Kind, x: number, z: number, y: number, w: number, d: number, c: number, more: Partial<Piece> = {}): Piece => {
  const h = kind === 'plate' || kind === 'tile' ? 1 : more.h ?? 3;
  return { x, z, y, h, w, d, c, kind, part: partId(kind, w, d, h), role: 'display', ...more };
};

function model(pieces: Piece[], pose: SqModel['pose'], display: Display, root: (p: Piece) => boolean): SqModel {
  const s = summarize(pieces, pose), np = pieces.findIndex(p => p.nameplate);
  const checks = checkModel(pieces, { root, base: root });
  return {
    id: 1234, format: 'relief', display, scale: 'small', pieces, steps: [pieces.map((_, i) => i)], stepNotes: {},
    ...s, checks: { ...checks, twoStud: null, comInside: null, rules: [] }, notes: ['synthetic test model'], pose,
    nameplate: np >= 0 ? { lines: nameplateLines(1234, '0xd553fb67359fc056'), piece: np } : null,
    hanging: null,
  };
}

const SPEC = [5, 4, 3, 34, 36, 39, 153, 7, 89, 71, 47];

function demoTable(): SqModel {
  const P: Piece[] = [];
  for (let x = 0; x < 24; x += 12) for (let z = 0; z < 12; z += 6) P.push(pc('plate', x, z, 0, 12, 6, 11));
  const used = new Set<string>(), take = (x: number, z: number, w: number, d: number) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) used.add(`${x + i},${z + j}`); };
  const free = (x: number, z: number, w: number, d: number) => { for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (used.has(`${x + i},${z + j}`)) return false; return true; };
  // nameplate, Technic bricks, Trans-Clear columns, a spectrum strip of tiles
  P.push(pc('tile', 9, 0, 1, 6, 2, 11, { nameplate: true })); take(9, 0, 6, 2);
  P.push(pc('technic', 17, 9, 1, 6, 1, 11), pc('technic', 18, 9, 4, 4, 1, 3)); take(17, 9, 6, 1);
  for (const [x, z] of [[5, 6], [9, 6]]) {
    P.push(pc('round', x, z, 1, 1, 1, 12, { h: 1, support: true }), pc('round', x, z, 2, 1, 1, 12, { support: true }), pc('round', x, z, 5, 1, 1, 12, { support: true }));
    take(x, z, 1, 1);
  }
  SPEC.forEach((c, i) => { P.push(pc('tile', 1 + 2 * i, 10, 1, 2, 1, c, { role: 'squiggle' })); take(1 + 2 * i, 10, 2, 1); });
  for (let z = 0; z < 12; z += 2) for (let x = 0; x < 24; x += 2) if (free(x, z, 2, 2)) { P.push(pc('tile', x, z, 1, 2, 2, 11)); take(x, z, 2, 2); }
  for (let z = 0; z < 12; z++) for (let x = 0; x < 24; x++) if (free(x, z, 1, 1)) { P.push(pc('tile', x, z, 1, 1, 1, 11)); take(x, z, 1, 1); }
  // a short floating ribbon, 3 wide, one slab (plate, plate, tile)
  [5, 4, 3].forEach((c, j) => {
    P.push(pc('plate', 3, 5 + j, 8, 8, 1, c, { role: 'squiggle' }));
    P.push(pc('tile', 3, 5 + j, 10, 4, 1, c, { role: 'squiggle' }), pc('tile', 7, 5 + j, 10, 4, 1, SPEC[3 + j], { role: 'squiggle' }));
  });
  for (let x = 3; x < 11; x++) P.push(pc('plate', x, 5, 9, 1, 3, x < 7 ? 5 : 34, { role: 'squiggle' }));   // ties the three rows
  return model(P, 'table', 'floating', p => p.y === 0);
}

function demoWall(): SqModel {
  const P: Piece[] = [];
  for (let x = 0; x < 20; x += 10) for (let z = 0; z < 12; z += 4) P.push(pc('plate', x, z, 0, 10, 4, 11));
  for (let x = 2; x < 18; x += 8) for (let z = 2; z < 10; z += 4) P.push(pc('plate', x, z, 1, 8, 4, 1));
  for (const z of [0, 1, 10, 11]) for (const x of [0, 10]) P.push(pc('technic', x, z, 1, 10, 1, 11));
  for (const x of [0, 1, 18, 19]) P.push(pc('technic', x, 2, 1, 1, 8, 11));
  // cap: 2×N tiles, nameplate bottom right
  P.push(pc('tile', 0, 0, 4, 6, 2, 11), pc('tile', 6, 0, 4, 6, 2, 11), pc('tile', 12, 0, 4, 6, 2, 11, { nameplate: true }), pc('tile', 18, 0, 4, 2, 2, 11));
  P.push(pc('tile', 0, 10, 4, 6, 2, 11), pc('tile', 6, 10, 4, 6, 2, 11), pc('tile', 12, 10, 4, 6, 2, 11), pc('tile', 18, 10, 4, 2, 2, 11));
  for (const x of [0, 18]) P.push(pc('tile', x, 2, 4, 2, 4, 11), pc('tile', x, 6, 4, 2, 4, 11));
  // ribbon: two steps of a 3-wide band on the white panel
  const band = (x: number, z: number, y: number, cols: number[]) => cols.forEach((c, j) => {
    P.push(pc('plate', x, z + j, y, 6, 1, c, { role: 'squiggle' }), pc('plate', x + 1, z + j, y + 1, 4, 1, c, { role: 'squiggle' }), pc('tile', x, z + j, y + 2, 6, 1, c, { role: 'squiggle' }));
  });
  band(4, 3, 2, [5, 4, 3]); band(10, 6, 2, [6, 39, 153]);
  P.push(pc('round', 6, 7, 2, 1, 1, 12, { h: 1, support: true }));
  // back: hanging points (top) and spacers (bottom), holes along x
  const back = [pc('technic', 1, 9, -3, 1, 2, 11), pc('technic', 18, 9, -3, 1, 2, 11), pc('technic', 1, 1, -3, 1, 2, 11), pc('technic', 18, 1, -3, 1, 2, 11)];
  P.push(...back);
  const m = model(P, 'wall', 'frame', p => p.y === 0);
  m.hanging = { points: [P.length - 4, P.length - 3], advice: 'Picture cord through both top holes, one picture hook.' };
  return m;
}

function demo(pose: SqModel['pose'] = 'table'): SqModel { return pose === 'wall' ? demoWall() : demoTable(); }

// ---- build animation, live stage, video ----

type Mode = [Format, Display | null, Scale];
const parseMode = (mode: string): Mode => { const [a, s = 'small'] = mode.split('-'); return a === 'mosaic' ? ['mosaic', null, s as Scale] : ['relief', a as Display, s as Scale]; };

/** Frames of the build animation with the page's camera, at fractions of the build (1 = finished). */
async function buildFrames(id: number, mode: string, at: number[], o: { width?: number; height?: number; ghosts?: boolean } = {}) {
  const m = await build(id, ...parseMode(mode));
  const s = new Stage(o.width ?? 600, o.height ?? 400, undefined, { ghosts: o.ghosts });
  s.setModel(m);
  const built = s.tl!.built;
  const frames = at.map(f => { const t = f * built; s.pose(t); s.frame(s.buildView(t)); return { t, img: s.toDataURL('image/jpeg', 0.86) }; });
  s.dispose();
  return { built, steps: m.steps.length, pieces: m.pieces.length, frames };
}

let liveStage: Stage | null = null;
/** The live stage in the page (#live), building the model. */
async function live(id: number, mode: string, o: { ghosts?: boolean; autoRotate?: boolean; play?: boolean } = {}) {
  const m = await build(id, ...parseMode(mode));
  let cv = document.getElementById('live') as HTMLCanvasElement | null;
  if (!cv) {
    document.body.insertAdjacentHTML('afterbegin', `<section id="live-box"><canvas id="live"></canvas><div class="bar">
      <button data-a="play">Play</button><button data-a="skip">Skip</button><button data-a="resetView">Reset view</button><span id="live-status"></span></div></section>`);
    cv = document.getElementById('live') as HTMLCanvasElement;
    document.querySelectorAll<HTMLButtonElement>('#live-box button').forEach(b => b.addEventListener('click', () => (liveStage as unknown as Record<string, () => void>)[b.dataset.a!]()));
  }
  liveStage ??= new Stage(cv, { ghosts: o.ghosts, autoRotate: o.autoRotate });
  const status = document.getElementById('live-status')!;
  liveStage.onFinished = () => { status.textContent = `built in ${liveStage!.tl!.built.toFixed(1)} s`; };
  liveStage.setModel(m);
  status.textContent = `${m.pieces.length} pieces · building…`;
  if (o.play !== false) liveStage.play();
  return { pieces: m.pieces.length, built: liveStage.tl!.built };
}

/** Record the video of a model; the file stays in the page as an object URL. */
async function video(id: number, mode: string, format: 'square' | 'story', small = false) {
  const m = await build(id, ...parseMode(mode)), fx = await fixture(id);
  const { recordVideo } = await import('../src/squiggle/video');
  const t = performance.now();
  const r = await recordVideo(m, { id: fx.id, original: await original(id, 900) }, { format, small });
  return { url: URL.createObjectURL(r.blob), ext: r.ext, bytes: r.blob.size, type: r.blob.type, duration: r.duration, ms: Math.round(performance.now() - t) };
}

const once = (el: EventTarget, ev: string) => new Promise<void>(res => el.addEventListener(ev, () => res(), { once: true }));

/** A recorded video read back: duration, size, frames at the given times (negative: from the end), and its audio. */
async function probe(url: string, times: number[], width = 540) {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  await Promise.race([once(v, 'loadeddata'), once(v, 'error').then(() => { throw new Error('the video does not load'); })]);
  if (!Number.isFinite(v.duration)) { v.currentTime = 1e6; await once(v, 'seeked'); }
  const duration = v.duration, c = document.createElement('canvas');
  c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
  const frames: { t: number; img: string }[] = [];
  for (const t0 of times) {
    const t = Math.max(0, Math.min(duration - 0.05, t0 < 0 ? duration + t0 : t0));
    v.currentTime = t; await once(v, 'seeked');
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    frames.push({ t, img: c.toDataURL('image/jpeg', 0.88) });
  }
  const ab = await (await fetch(url)).arrayBuffer(), ac = new AudioContext();
  const audio = await ac.decodeAudioData(ab).then(b => {
    const d = b.getChannelData(0);
    let peak = 0, sum = 0, loud = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); sum += d[i] * d[i]; }
    // clicks: 10 ms windows much louder than the average
    const win = Math.round(b.sampleRate / 100), rms = Math.sqrt(sum / d.length);
    for (let i = 0; i + win <= d.length; i += win) { let e = 0; for (let j = i; j < i + win; j++) e += d[j] * d[j]; if (Math.sqrt(e / win) > 3 * rms) loud++; }
    return { channels: b.numberOfChannels, duration: b.duration, sampleRate: b.sampleRate, peak, rms, loudWindows: loud };
  }, e => ({ error: String(e) }));
  await ac.close();
  return { duration, width: v.videoWidth, height: v.videoHeight, frames, audio };
}

async function base64(url: string): Promise<string> {
  const b = await (await fetch(url)).blob();
  return new Promise(res => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.readAsDataURL(b); });
}

const sq = {
  build, render, original, report, demo, fixture, buildFrames, live, video, probe, base64,
  get lastMs() { return lastMs; }, get stage() { return stage; }, get liveStage() { return liveStage; },
};
Object.assign(window, { sq });

// page: the two synthetic poses, plus ?id=&mode= (e.g. mode=frame-small, mosaic-large)
const out = document.getElementById('out')!;
const fig = (src: string, cap: string) => { const f = document.createElement('figure'); f.innerHTML = `<img src="${src}" alt=""><figcaption>${cap}</figcaption>`; out.append(f); };
const q = new URLSearchParams(location.search);
if (q.has('live')) {
  await live(+(q.get('id') ?? 1234), q.get('mode') ?? 'frame-large', { ghosts: q.has('ghosts'), autoRotate: q.has('rotate') });
} else if (q.get('id')) {
  const id = +q.get('id')!, [a, s = 'small'] = (q.get('mode') ?? 'frame-small').split('-');
  fig(await original(id, 900), `#${id} · Art Blocks (redrawn from the fixture)`);
  const r = await report(id, a === 'mosaic' ? 'mosaic' : 'relief', a === 'mosaic' ? null : a as Display, s as Scale, { width: 1200, height: 800 });
  if (r.ok) fig(r.img, `#${id} · ${a} ${s} · ${r.pieces} pieces · ${r.dims.join(' × ')} cm · ${r.ms} ms`);
  else out.insertAdjacentHTML('beforeend', `<p class="err">${r.error}</p>`);
} else {
  for (const pose of ['table', 'wall'] as const) {
    const m = demo(pose), t = performance.now(), img = render(m, { width: 1200, height: 800 });
    fig(img, `Synthetic ${pose} model · ${m.pieces.length} pieces · ${Math.round(performance.now() - t)} ms · ${m.checks.collisions} collisions · ${m.checks.floating} floating`);
  }
}
Object.assign(window, { stageReady: true });
