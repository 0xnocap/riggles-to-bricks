// Video of a Squiggle model (square or 9:16): the finished model for a moment (the
// first frame is the preview apps show), a quick dissolve, from the same camera, to
// the empty panel or base (the Squiggle's pieces gone), the build with brick clicks,
// a slow move round the finished model, a short look at the nameplate, then the
// whole model again under its titles, ≈ 23 s. Titles, the original Squiggle and the
// site's mark over the 3D (the Frame on its wall: built seen from aside, where its
// layers show, then faced for the end of the build); in the square the model keeps
// clear of the original's card in the top right corner. Recorded in real time with
// MediaRecorder, MP4 when the browser can, else WebM. The audio clock drives the
// frames, 30 a second, each handed to the recorder as it is drawn (a canvas track
// without a frame rate of its own), and the recorder runs on for a moment on the
// last picture: the picture and the sound end together however busy the device.
// A take starts once the page is calm; one whose audio clock falls behind the wall
// clock is dropped, one with a hitch (a moving picture held over 0.1 s, say while
// the visitor switches models) is done again, and the smoothest take is kept. Each
// take films a canvas of its own, made just before it: in Chrome, a canvas filmed a
// while after it was made comes out washed out (full range colours flagged as TV).
import * as THREE from 'three';
import { renderHex } from '../core/palette';
import { makeSoundtrack } from '../export/sound';
import { SITE_NAME, SITE_URL } from './exports';
import type { SqModel } from './model';
import { SPECTRUM } from './spectrum';
import { Stage, STAGE_BG, type Shot, type View } from './stage';
import { buildTurn, clamp01, easeIO, lerp } from './timeline';

export type VideoFormat = 'square' | 'story';
/** what the video needs of the loaded Squiggle (a `Loaded` from load.ts will do) */
export interface VideoSource { id: number | null; original?: string | null }
/** `take`: 1, or 2 and 3 when a take is done again (the page was busy: "Recording again…") */
export interface VideoOptions { format: VideoFormat; small?: boolean; onProgress?: (stage: 'preparing' | 'recording', f: number, take: number) => void }
/** how the kept take went: pictures drawn, the longest wait between two while the picture moves (s), the waits
 *  over STALL among those, takes recorded */
export interface VideoStats { frames: number; gap: number; stalls: number; takes: number }
/** a box of the picture, px: left, top, right, bottom */
export type Box = [number, number, number, number];

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const INK = '#16242f', MUTED = '#5a6b78', CAPTION = 'The original, on Art Blocks';
/** seconds: the finished model, the dissolve to the empty panel or base, a beat before the first piece, the camera's
 *  swing aside, the build, a turn round the model, to the nameplate, on it, back, the end under the titles */
const INTRO = 0.7, FADE = 0.4, LEAD = 0.15, SWING = 1.5, BUILD = 12.8, HERO = 3, TO_NP = 1.2, NP_HOLD = 0.8, BACK = 1.3, END = 2.6;
/** pictures a second; a take is dropped when the audio clock and the wall clock part by more than DRIFT (s), done
 *  again when two moving pictures are more than STALL s apart (from about three missed pictures a hitch shows), at
 *  most TAKES takes; TAIL: s recorded on the last picture */
const FPS = 30, DRIFT = 0.2, STALL = 0.1, TAKES = 3, TAIL = 0.25;
/** the page is calm once no animation frame came later than LATE s for CALM s */
const LATE = 0.05, CALM = 0.3;
/** video bits a second: 1080 px square, 1080 × 1920, the small variants (phones) */
const RATE = { square: 4_200_000, story: 5_000_000, small: 2_500_000 };
/** px at 1080 wide: [size, baseline] of the texts, the original's box [w, h, top], the model's band [top, bottom] */
const LAYOUT = {
  square: { title: [44, 76], sub: [32, 122], card: [236, 157, 40], band: [170, 950], name: [36, 1002], url: [24, 1040] },
  story: { title: [66, 330], sub: [42, 398], card: [640, 427, 452], band: [960, 1540], name: [46, 1606], url: [30, 1652] },
};
/** px at 1080 wide the model keeps from the square's card and its caption; shots fitted along the turn round the
 *  finished model */
const CARD_ROOM = 20, TURN_SHOTS = 24;

export function videoMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return null;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Chromie Squiggle #1234" and "674 pieces · Frame · 54 × 29 cm" */
export function videoTitles(m: SqModel, src: VideoSource): [string, string] {
  const d = m.dims.map(v => Math.round(v)), what = m.format === 'mosaic' ? 'Mosaic' : cap(m.display ?? 'frame');
  const size = m.pose === 'wall' ? `${d[0]} × ${d[2]}` : m.format === 'mosaic' ? `${d[0]} × ${d[1]}` : `${d[0]} × ${d[1]} × ${d[2]}`;
  return [src.id !== null ? `Chromie Squiggle #${src.id}` : 'My Chromie Squiggle', `${m.pieces.length.toLocaleString('en')} pieces · ${what} · ${size} cm`];
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(res => {
    const img = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) img.crossOrigin = 'anonymous';   // else the recording is refused
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = url;
  });
}

/** a gentle ease in and out (half the top speed of easeIO), for the moves to the nameplate and back */
const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** between two shots: the direction turns, the distance scales, the target slides with the distance covered (zooming
 *  in, it is there before the close up, where any slide would be magnified; zooming out, it leaves late) */
function mix(a: Shot, b: Shot, u: number): Shot {
  const sa = new THREE.Spherical().setFromVector3(a.dir), sb = new THREE.Spherical().setFromVector3(b.dir);
  let dt = sb.theta - sa.theta;
  dt -= Math.round(dt / (2 * Math.PI)) * 2 * Math.PI;
  const dist = a.dist * Math.pow(b.dist / a.dist, u), w = Math.abs(Math.log(b.dist / a.dist)) > 0.05 ? (a.dist - dist) / (a.dist - b.dist) : u;
  return {
    target: a.target.clone().lerp(b.target, w), fov: lerp(a.fov, b.fov, u), dist,
    dir: new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, lerp(sa.phi, sb.phi, u), sa.theta + dt * u)),
  };
}

/** the picture's size: 1080 wide, 2/3 of it for phones */
export function videoSize(o: Pick<VideoOptions, 'format' | 'small'>): { k: number; W: number; H: number } {
  const k = o.small ? 2 / 3 : 1;
  return { k, W: Math.round(1080 * k), H: Math.round((o.format === 'story' ? 1920 : 1080) * k) };
}

/** The video's off-screen stage, holding the model. The display under the Squiggle (the Frame's empty panel, a base)
 *  stands from the start: the build is the Squiggle's. */
export function videoStage(m: SqModel, o: Pick<VideoOptions, 'format' | 'small'>): Stage {
  const { W, H } = videoSize(o);
  const stage = new Stage(W, H, undefined, { supersample: o.small ? 1 : 1.5, lowPower: o.small, timeline: { build: BUILD, base: true } });
  try { stage.setModel(m); } catch (e) { stage.dispose(); throw e; }
  return stage;
}

/** The video's layout and camera, for recordVideo and the checks. */
export interface VideoPlan {
  W: number; H: number; duration: number;
  /** s: the dissolve, the first piece's beat, the build over, to the nameplate, on it, back from it, the end (the
   *  picture moves from `intro` to `tEnd`) */
  times: { intro: number; t1: number; tb: number; tc: number; tn: number; te: number; tEnd: number };
  /** the nameplate close up is part of the video */
  close: boolean;
  titles: [string, string];
  shotAt(t: number): Shot;
  /** opacity of the titles, the original and the site's mark at t (they step aside for the nameplate close up) */
  alpha(t: number): number;
  /** the original's card and its caption (baseline, size), px */
  card: { x: number; y: number; w: number; h: number; caption: [number, number, number] } | null;
  /** px: the titles' block and the card with its caption (null without an original) */
  boxes: { title: Box; card: Box | null };
  /** a box of the picture as a rectangle of the model camera's view (Stage.reach's measure) */
  toView(b: Box): [number, number, number, number];
}

/** Sets the camera of the video's stage (videoStage) for the band between the titles and the site's mark, and plans
 *  the video; `img` is the original (null: none). */
export function planVideo(stage: Stage, m: SqModel, src: VideoSource, img: HTMLImageElement | null, o: Pick<VideoOptions, 'format' | 'small'>): VideoPlan {
  const story = o.format === 'story', L = LAYOUT[o.format], { k, W, H } = videoSize(o), px = (v: number) => Math.round(v * k);
  // a camera for the band, its view extended to the whole picture. 9:16: everything in the middle (apps cover the top
  // and bottom), under the titles and the original
  const [y0, y1] = L.band.map(px), cam = stage.camera;
  cam.aspect = W / (y1 - y0);
  cam.setViewOffset(W, y1 - y0, 0, -y0, W, H);
  const toView = ([a, b, c, d]: Box): [number, number, number, number] =>
    [(2 * a) / W - 1, 1 - (2 * (d - y0)) / (y1 - y0), (2 * c) / W - 1, 1 - (2 * (b - y0)) / (y1 - y0)];
  const mx = document.createElement('canvas').getContext('2d')!;
  const textW = (font: string, s: string) => { mx.font = `${font} ${FONT}`; return mx.measureText(s).width; };
  const titles = videoTitles(m, src);
  const tw = Math.max(textW(`800 ${px(L.title[0])}px`, titles[0]), textW(`500 ${px(L.sub[0])}px`, titles[1])), tx = story ? (W - tw) / 2 : px(44);
  const title: Box = [tx, px(L.title[1] - L.title[0]), tx + tw, px(L.sub[1] + L.sub[0] * 0.3)];
  let card: VideoPlan['card'] = null, cardBox: Box | null = null;
  if (img) {
    // at most the layout's box, whatever the picture's shape (an upload may be any)
    const [bw, bh, top] = L.card, f = Math.min(bw / img.width, bh / img.height) * k, w = img.width * f, h = img.height * f;
    const x = story ? (W - w) / 2 : W - px(44) - w, y = px(top), size = px(story ? 26 : 20), base = y + h + px(story ? 44 : 30);
    const cw = textW(`500 ${size}px`, CAPTION), cx = story ? (W - cw) / 2 : x + w - cw;
    card = { x, y, w, h, caption: [story ? W / 2 : x + w, base, size] };
    cardBox = [Math.min(x, cx), y, Math.max(x + w, cx + cw), base + size * 0.3];
  }

  const tl = stage.tl!, wall = m.pose === 'wall', home = stage.defaultView;
  const view = (az: number, el: number, margin: number): View => ({ ...home, az: home.az + az, el: home.el + el, margin: home.margin + margin });
  // the square's card sits in the band's top right corner: every shot keeps the model out of it (a Backdrop's wall
  // would reach under it), zooming out just enough, the model shrinking towards the bottom of the band
  const keep = !story && cardBox ? toView([cardBox[0] - px(CARD_ROOM), 0, W, cardBox[3] + px(CARD_ROOM)]) : null;
  const fit = (v: View) => { const s = stage.fit(v); return keep ? stage.avoidCorner(s, [keep[0], keep[1]], v.margin) : s; };
  // a turn from the left during the build, to the right after it (less for the flat Mosaic; the Frame from well aside
  // and above, faced at the end: from the front, its layers would hide each other)
  const flat = m.format === 'mosaic', A = fit(view(wall || !flat ? -30 : -16, wall ? 22 : flat ? 8 : 12, 0.06)), B = fit(home);
  // the turn after the build is framed all the way, not only at its ends (between them, a Backdrop's wall turning to
  // face the camera would rise under the card): fitted shots along it, mixed between neighbours
  const vc = view(wall ? 16 : flat ? 14 : 26, wall ? 5 : -6, -0.02);
  const turn = [B, ...Array.from({ length: TURN_SHOTS }, (_, i) => {
    const u = (i + 1) / TURN_SHOTS;
    return fit({ ...home, az: lerp(home.az, vc.az, u), el: lerp(home.el, vc.el, u), margin: lerp(home.margin, vc.margin, u) });
  })];
  const C = turn[TURN_SHOTS];
  const round = (u: number): Shot => { const f = clamp01(u) * TURN_SHOTS, i = Math.min(TURN_SHOTS - 1, Math.floor(f)); return mix(turn[i], turn[i + 1], f - i); };
  // the nameplate close up, from the right and a little above (wall) or from the front, above (table)
  let N: Shot | null = null;
  if (m.nameplate) {
    const box = stage.pieceBox([m.nameplate.piece]), size = box.getSize(new THREE.Vector3());
    const dir = stage.fit(view(wall ? 20 : 12, wall ? 12 : 16, 0)).dir, fov = home.fov;
    const long = Math.max(size.x, size.z, wall ? size.y : 0), tanH = Math.tan((fov * Math.PI) / 360) * cam.aspect;
    N = { target: box.getCenter(new THREE.Vector3()), dir, fov, dist: long / 2 / (tanH * (story ? 0.62 : 0.42)) };
  }
  const t1 = INTRO + FADE + LEAD, tb = t1 + tl.built, tc = tb + HERO, tn = tc + TO_NP, te = tn + NP_HOLD, tEnd = te + BACK, duration = tEnd + END;
  const shotAt = (t: number): Shot => {
    if (t < tb) {
      // from the opening camera to the build's, once the dissolve is nearly over
      const S = mix(A, B, buildTurn(t - t1, tl.built, wall)), g = easeIO((t - INTRO - FADE * 0.6) / SWING);
      return g >= 1 ? S : mix(B, S, g);
    }
    if (!N) { const u = clamp01((t - tb) / (tEnd - tb)); return round(easeSine(2 * Math.min(u, 1 - u))); }
    if (t < tc) return round(easeIO((t - tb) / HERO));
    const N2 = { ...N, dist: N.dist * 0.94 };
    if (t < tn) return mix(C, N, easeSine((t - tc) / TO_NP));
    if (t < te) return mix(N, N2, (t - tn) / NP_HOLD);
    return mix(N2, B, easeSine((t - te) / BACK));
  };
  // the titles and the original step aside for the nameplate close up (it carries the name), and come back for the end
  const alpha = (t: number) => N ? Math.min(1, Math.max(0, 1 - easeIO((t - tc) / (TO_NP * 0.6))) + easeIO((t - te - BACK * 0.4) / (BACK * 0.6))) : 1;
  return { W, H, duration, times: { intro: INTRO, t1, tb, tc, tn, te, tEnd }, close: !!N, titles, shotAt, alpha, card, boxes: { title, card: cardBox }, toView };
}

/** Until the page is calm (no animation frame late for CALM s), at least `min` s and at most `max` s: a take started
 *  while the page is still busy (the visitor has just switched models) would hitch. */
function settle(min: number, max: number): Promise<void> {
  return new Promise(res => {
    const t0 = performance.now();
    let last = t0, calm = t0, over = false;
    const stop = () => { if (!over) { over = true; res(); } };
    setTimeout(stop, max * 1000);   // a hidden tab gets no animation frames
    const step = () => {
      if (over) return;
      const now = performance.now();
      if (now - last > LATE * 1000) calm = now;
      last = now;
      if (now - t0 >= min * 1000 && now - calm >= CALM * 1000) stop(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export async function recordVideo(m: SqModel, src: VideoSource, o: VideoOptions): Promise<{ blob: Blob; ext: 'mp4' | 'webm'; duration: number; stats: VideoStats }> {
  const kind = videoMime();
  if (!kind) throw new Error('This browser can’t record video. Try Chrome, Edge, Firefox or Safari 14.1+.');
  o.onProgress?.('preparing', 0, 1);
  const story = o.format === 'story', L = LAYOUT[o.format], { k, W, H } = videoSize(o), px = (v: number) => Math.round(v * k);
  const stage = videoStage(m, o);
  let ac: AudioContext | null = null, stream = null as MediaStream | null;
  try {
    const img = src.original ? await loadImage(src.original) : null;
    const plan = planVideo(stage, m, src, img, o), { duration, shotAt, alpha } = plan, { t1, tc, te, tEnd } = plan.times, tl = stage.tl!;
    const [title, sub] = plan.titles, url = SITE_URL.replace(/^https:\/\/|\/$/g, '');
    const gl = stage.renderer.domElement;
    // the picture filmed: a canvas made afresh for each take
    let out!: HTMLCanvasElement, x!: CanvasRenderingContext2D;
    const canvas = () => {
      out = document.createElement('canvas'); out.width = W; out.height = H;
      x = out.getContext('2d')!; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    };
    // the opening picture: the finished model from the front
    const still = document.createElement('canvas'); still.width = W; still.height = H;
    stage.pose(Infinity); stage.look(shotAt(0)); stage.render();
    const sx = still.getContext('2d')!;
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
    sx.drawImage(gl, 0, 0, W, H);
    // and the empty panel or base, and a first piece on its way, once: the dissolve's first picture and the first
    // pieces (a fading one's own material) then come as fast as the others
    const first = tl.order.find(i => Number.isFinite(tl.start[i]));
    for (const w of [INTRO - t1, ...(first !== undefined ? [tl.start[first] + tl.drop * 0.2] : [])]) { stage.pose(w); stage.render(); }
    const card = (a: number) => {
      const c = plan.card;
      if (!img || !c || a <= 0) return;
      const r = 10 * k;
      x.save(); x.globalAlpha = a;
      x.shadowColor = 'rgba(22,36,47,0.18)'; x.shadowBlur = 24 * k; x.shadowOffsetY = 6 * k;
      x.fillStyle = '#fff'; x.beginPath(); x.roundRect(c.x, c.y, c.w, c.h, r); x.fill();
      x.shadowColor = 'transparent';
      x.save(); x.beginPath(); x.roundRect(c.x, c.y, c.w, c.h, r); x.clip(); x.drawImage(img, c.x, c.y, c.w, c.h); x.restore();
      x.strokeStyle = 'rgba(22,36,47,0.12)'; x.lineWidth = Math.max(1, k); x.beginPath(); x.roundRect(c.x, c.y, c.w, c.h, r); x.stroke();
      x.fillStyle = INK; x.globalAlpha = a * 0.65; x.textAlign = story ? 'center' : 'right';
      x.font = `500 ${c.caption[2]}px ${FONT}`;
      x.fillText(CAPTION, c.caption[0], c.caption[1]);
      x.restore();
    };
    // the share image's footer: eleven bricks stepping up and down, the site's name, its address under it
    const brand = () => {
      const [ns, nb] = L.name, [us, ub] = L.url, s = (ns * k) / 24, bw = Math.round(7 * s), gap = Math.round(14 * s);
      x.font = `800 ${px(ns)}px ${FONT}`;
      const nameW = x.measureText(SITE_NAME).width, mw = SPECTRUM.length * bw;
      const x0 = Math.round(story ? (W - mw - gap - nameW) / 2 : px(44)), base = px(nb);
      SPECTRUM.forEach((c, i) => { x.fillStyle = renderHex(c.id); x.fillRect(x0 + i * bw, Math.round(base - 17 * s + Math.sin(i * 0.7) * 4 * s), bw, Math.round(12 * s)); });
      x.fillStyle = INK; x.textAlign = 'left'; x.fillText(SITE_NAME, x0 + mw + gap, base);
      x.fillStyle = MUTED; x.font = `500 ${px(us)}px ${FONT}`; x.textAlign = story ? 'center' : 'left';
      x.fillText(url, story ? W / 2 : x0 + mw + gap, px(ub));
    };
    // the 3D is drawn only when something moved: the pieces until the last one lands, the camera until the end
    let posed = NaN, still3d = false;
    const frame = (t: number) => {
      x.fillStyle = STAGE_BG; x.fillRect(0, 0, W, H);
      if (t < INTRO) x.drawImage(still, 0, 0);
      else {
        const bt = Math.min(t - t1, tl.built + 0.01), end = t >= tEnd;
        if (!(end && still3d)) {
          if (bt !== posed) { stage.pose(bt); posed = bt; }
          stage.look(shotAt(t)); stage.render();
        }
        still3d = end;
        x.drawImage(gl, 0, 0, W, H);
        // the finished model dissolves into the empty panel or base, seen from the same place
        if (t < INTRO + FADE) { x.globalAlpha = 1 - easeIO((t - INTRO) / FADE); x.drawImage(still, 0, 0); x.globalAlpha = 1; }
      }
      const a = alpha(t);
      if (a <= 0) return;
      card(a);
      x.save(); x.globalAlpha = a; x.fillStyle = INK; x.textAlign = story ? 'center' : 'left';
      const tx = story ? W / 2 : px(44);
      x.font = `800 ${px(L.title[0])}px ${FONT}`; x.fillText(title, tx, px(L.title[1]));
      x.font = `500 ${px(L.sub[0])}px ${FONT}`; x.fillText(sub, tx, px(L.sub[1]));
      brand();
      x.restore();
    };

    const ctx = ac = new AudioContext({ sampleRate: 48000 });
    const buf = makeSoundtrack(m, { start: tl.start.map(v => v + t1), drop: tl.drop }, duration, undefined, {
      whooshes: [[INTRO - 0.05, FADE + 0.5, 0.1], ...(plan.close ? [[tc - 0.1, TO_NP + 0.25, 0.18], [te - 0.1, BACK + 0.25, 0.15]] as [number, number, number][] : [])],
    });
    const dest = ctx.createMediaStreamDestination();
    // a silent source keeps the sound track running before and after the soundtrack (else it ends with it)
    const hush = ctx.createConstantSource();
    hush.offset.value = 0; hush.connect(dest); hush.start();
    await ctx.resume().catch(() => undefined);

    type Take = { blob: Blob; frames: number; gap: number; stalls: number; lost: number };
    /** take `no`, or null when its audio clock fell behind the wall clock (or ran ahead of it) */
    const take = async (no: number): Promise<Take | null> => {
      canvas(); frame(0);
      // a canvas track that takes a picture only when asked (else one at FPS, where the browser can't be asked)
      let vt = out.captureStream(0).getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
      if (typeof vt.requestFrame !== 'function') { vt.stop(); vt = out.captureStream(FPS).getVideoTracks()[0]; }
      const shoot = () => vt.requestFrame?.();
      const tracks = stream = new MediaStream([vt, ...dest.stream.getAudioTracks()]);
      const play = ctx.createBufferSource();
      play.buffer = buf; play.connect(dest);
      const rec = new MediaRecorder(tracks, { mimeType: kind.mime, videoBitsPerSecond: o.small ? RATE.small : RATE[o.format], audioBitsPerSecond: 128_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<void>(res => { rec.onstop = () => res(); });
      rec.start(250);
      frame(0); shoot();
      const t0 = ctx.currentTime + 0.05, p0 = performance.now() + 50, audio = ctx.state === 'running';
      play.start(t0);
      // the audio clock drives the animation (the wall clock if audio is blocked); the gap between the two is watched
      const wallT = () => (performance.now() - p0) / 1000;
      let gap0: number | null = null, drift = 0, slot = 0, frames = 1, last = performance.now(), shown = 0, gap = 0, stalls = 0, lost = 0;
      await new Promise<void>(res => {
        const step = () => {
          const t = audio ? ctx.currentTime - t0 : wallT();
          if (audio) {
            const d = wallT() - t;
            gap0 ??= d;
            drift = Math.abs(d - gap0);
            if (drift > DRIFT) return res();
          }
          // a picture for each 1/FPS s (the latest time when the device fell behind), until TAIL s after the end
          const n = Math.floor(Math.max(0, t) * FPS);
          if (n > slot) {
            const at = Math.min(Math.max(0, t), duration);
            frame(at); shoot();
            const now = performance.now(), wait = (now - last) / 1000;
            // a wait shows only while the picture moves: not on the opening still, nor on the end
            if (at > INTRO && shown < tEnd) {
              gap = Math.max(gap, wait);
              if (wait > STALL) { stalls++; lost += wait - 1 / FPS; }
            }
            last = now; shown = at; slot = n; frames++;
            o.onProgress?.('recording', Math.min(1, Math.max(0, t) / duration), no);
          }
          if (t >= duration + TAIL) return res();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      rec.stop();
      play.stop(); play.disconnect();
      await done;
      vt.stop();
      return drift > DRIFT ? null : { blob: new Blob(chunks, { type: kind.mime.split(';')[0] }), frames, gap, stalls, lost };
    };
    await settle(0, 1.5);
    o.onProgress?.('preparing', 1, 1);
    let best: Take | null = null, prev: Take | null = null, n = 1;
    for (; ; n++) {
      const r = await take(n);
      if (r && (!best || r.lost < best.lost || (r.lost === best.lost && r.gap < best.gap))) best = r;
      // done when smooth; also when a second take with hitches is not much smoother than the one before: the device's
      // own pace rather than a passing load, which a third take would not escape
      if ((best && best.gap <= STALL) || n >= TAKES || (r && prev && r.lost > prev.lost / 2)) break;
      if (r) prev = r;
      o.onProgress?.('preparing', 0, n + 1);
      await settle(1, 5);
      o.onProgress?.('preparing', 1, n + 1);
    }
    if (!best) throw new Error('the device was too busy to keep the sound in time with the picture. Close other tabs or apps and try again.');
    return { blob: best.blob, ext: kind.ext, duration, stats: { frames: best.frames, gap: best.gap, stalls: best.stalls, takes: n } };
  } finally {
    stream?.getTracks().forEach(tr => tr.stop());
    await ac?.close().catch(() => undefined);
    stage.dispose();
  }
}
