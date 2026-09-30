// Squiggle to Bricks, the page: a Chromie Squiggle by number (or from a picture)
// becomes brick models. ① the original next to the live 3D model, the choice of
// model and its figures, ② the instructions reader, ③ the shopping list and the
// order files. Everything runs in the browser; the models are built in workers.
import { elementId } from './core/lego';
import { orderSummary } from './export/order';
import { brickLinkId } from './export/parts';
import { makeBooklet, partIcon, SqPageMaker } from './squiggle/booklet';
import { buildAll, DISPLAYS, type Builds, type ModelRequest } from './squiggle/builder';
import { brickLinkXML, fileBase, makeKit, modelLabel, nameplateFiles, partsCSV, pickABrickFiles, pickABrickNames, shareImage, sizeText, squiggleName } from './squiggle/exports';
import { failFromUrl, loadSquiggle, loadUpload, type Loaded } from './squiggle/load';
import type { Display, Format, Scale, SqBomLine, SqModel } from './squiggle/model';
import { drawDots, portSquiggle } from './squiggle/port';
import { imageUrl, SQUIGGLE_CONTRACT } from './squiggle/source';
import type { Stage } from './squiggle/stage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const stageModule = () => import('./squiggle/stage');
const DISPLAY: Record<Display, string> = { frame: 'Frame', floating: 'Floating', backdrop: 'Backdrop' };
// where the Squiggle came from: said once, under the original. How close the reading is (loaded.notes) goes in "More
// info", with what was read; the estimated features have their own "≈ Estimated from…" label.
const ORIGIN: Record<Loaded['origin'], string> = {
  script: 'Redrawn in your browser with its own script, from Art Blocks.',
  port: 'Redrawn from its hash with a copy of its script (the original one couldn’t run here).',
  image: 'Traced from Art Blocks’ picture of it.',
  upload: 'Traced from your picture.',
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const kg = (g: number) => (g >= 995 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g / 10) * 10} g`);   // as in the booklet
const times = (s: string) => s.replace(/(\d+) x (\d+)/g, '$1×$2');
const thin = (s: string) => s.replace(/ × /g, '\u2009×\u2009');   // 38 × 32 × 20 fits a phone's figure card
const PL = 0.4;   // a plate's height, in studs

// ---------- state ----------
const choice: { format: Format; display: Display; relief: Scale; mosaic: Scale } = { format: 'relief', display: 'frame', relief: 'large', mosaic: 'large' };
const request = (): ModelRequest => choice.format === 'relief'
  ? { format: 'relief', display: choice.display, scale: choice.relief }
  : { format: 'mosaic', scale: choice.mosaic };
const built = (b: Builds, r: ModelRequest) => (r.format === 'mosaic' ? b.mosaic[r.scale] : b.relief[r.scale]?.[r.display ?? 'frame']) ?? null;
let loaded: Loaded | null = null, builds: Builds | null = null, model: SqModel | null = null;
let loadGen = 0, viewGen = 0;
const played = new WeakSet<SqModel>();

// ---------- the live stage (three.js is loaded on the first Build) ----------
let stage: Stage | null = null, stageP: Promise<Stage> | null = null;
const liveStage = () => stageP ??= stageModule().then(({ Stage }) => {
  const s = stage = new Stage($<HTMLCanvasElement>('view'), { lowPower: isPhone, autoRotate: true });
  s.onFinished = () => { $('hint').hidden = false; $('skip').hidden = true; };
  if (matchMedia('(pointer: coarse)').matches) $('hint').textContent = 'Drag to turn · pinch to zoom';
  // "Reset view" once the visitor has turned or zoomed the model
  let down = false;
  s.controls?.addEventListener('start', () => { down = true; });
  s.controls?.addEventListener('end', () => { down = false; });
  s.controls?.addEventListener('change', () => { if (down) $('reset').hidden = false; });
  return s;
});

// ---------- input ----------
// One history entry per Squiggle shown (?id=1234, or none for a picture): Back and Forward bring them back.
type Nav = 'push' | 'replace' | null;
const kept = new Map<string, Loaded>();      // the last Squiggles shown, by key ('id:1234', 'up:1')
let shownKey: string | null = null, pending = false, upSeq = 0;
async function start(job: () => Promise<Loaded>, label: string, key: string, url: URL | null, nav: Nav) {
  const my = ++loadGen;
  pending = true;
  showError(null);
  const first = !loaded;
  $('result').hidden = false; $('secnav').hidden = false;   // before the scroll below: the menu would push section ① down
  $('original').classList.add('loading');
  if (first) $('orig-title').textContent = label.replace(/…$/, '');
  busy(label);
  $('sec-model').scrollIntoView({ behavior: 'smooth', block: 'start' });
  liveStage();
  let l: Loaded;
  try { l = await job(); } catch (e) {
    if (my !== loadGen) return;
    pending = false;
    busy(null);
    $('original').classList.remove('loading');
    if (first) { $('result').hidden = true; $('secnav').hidden = true; }
    const msg = (e as Error).message || 'Something went wrong.';
    showError(msg, /upload/i.test(msg));
    $('input-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (my !== loadGen) return;
  pending = false;
  if (nav && url) history[nav === 'push' && history.state?.key !== key ? 'pushState' : 'replaceState']({ key }, '', url);
  kept.delete(key); kept.set(key, l);
  if (kept.size > 8) kept.delete(kept.keys().next().value!);
  shownKey = key;
  loaded = l; builds = buildAll(l); model = null;
  showOriginal(l);
  await showChoice();
}

function byNumber(n: number, nav: Nav = 'push') {
  $<HTMLInputElement>('sq-number').value = String(n);
  const u = new URL(location.href); u.hash = ''; u.searchParams.set('id', String(n));
  const my = loadGen + 1;     // the load start() begins
  start(() => loadSquiggle(n, {
    fail: failFromUrl(),
    onStep: s => busy(s === 'script' ? `Redrawing Squiggle #${n} with its own script…` : s === 'port' ? `Redrawing Squiggle #${n} from its hash…` : `Reading Art Blocks’ picture of Squiggle #${n}…`),
    onSlow: () => {
      if (my !== loadGen) return;
      const up = document.createElement('label');
      up.className = 'linkbtn'; up.htmlFor = 'file'; up.textContent = 'upload an image of it';
      busy('Art Blocks is slow to answer. Still trying… or ');
      $('busy-text').append(up, '.');
    },
  }), `Getting Squiggle #${n} from Art Blocks…`, `id:${n}`, u, nav);
}
function byPicture(f: File) {
  const u = new URL(location.href); u.hash = ''; u.searchParams.delete('id');
  start(() => loadUpload(f), 'Reading your picture…', `up:${++upSeq}`, u, 'push');
}
/** a Squiggle number as typed or linked ("#1234", " 01234 "), or null */
const squiggleNo = (s: string | null) => { const v = s?.trim().replace(/^#/, '') ?? ''; return /^\d+$/.test(v) && +v <= 9999 ? +v : null; };
const urlId = () => squiggleNo(new URLSearchParams(location.search).get('id'));
/** Back to the page as it opens: no Squiggle */
function landing() {
  ++loadGen; ++viewGen;
  pending = false; shownKey = null; loaded = null; builds = null; model = null;
  busy(null); showError(null);
  $('original').classList.remove('loading');
  $('result').hidden = true; $('secnav').hidden = true;
  $<HTMLInputElement>('sq-number').value = '';
  scrollTo({ top: 0 });
}
history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  const key = (history.state as { key?: string } | null)?.key ?? null, id = urlId(), l = key ? kept.get(key) : undefined;
  if (key && key === shownKey) {   // back on the Squiggle on screen: a load in progress is dropped
    if (pending) { ++loadGen; pending = false; busy(null); $('original').classList.remove('loading'); }
    return;
  }
  if (l && key) {
    $<HTMLInputElement>('sq-number').value = l.id === null ? '' : String(l.id);
    start(async () => l, l.id === null ? 'Reading your picture…' : `Getting Squiggle #${l.id}…`, key, null, null);
  } else if (id !== null) byNumber(id, null);
  else landing();
});

const num = $<HTMLInputElement>('sq-number');
num.addEventListener('input', () => { const v = num.value.replace(/^\s*#/, ''); if (v !== num.value) num.value = v; });   // the # is already shown
num.addEventListener('beforeinput', e => {   // "#1234" or " 1234 " pasted goes in as 1234; longer numbers stay whole so Build can say they are out of range
  const t = e.data ?? e.dataTransfer?.getData('text/plain') ?? '', v = t.trim().replace(/^#\s*/, '');
  if (v === t || !e.cancelable) return;
  e.preventDefault();
  const a = num.selectionStart ?? num.value.length, z = num.selectionEnd ?? a;
  num.setRangeText(v.slice(0, Math.max(0, num.maxLength - num.value.length + z - a)), a, z, 'end');
  num.dispatchEvent(new Event('input', { bubbles: true }));
});
num.closest('.num-row')!.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('button')) num.focus(); });
$('by-number').addEventListener('submit', e => {
  e.preventDefault();
  const n = squiggleNo(num.value);
  if (n === null) { showError('Type a Squiggle number from 0 to 9999.'); return; }
  byNumber(n);
});
for (const id of ['file', 'file2']) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) byPicture(f); input.value = ''; });
}
$('upload-link').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
{ // drop or paste a picture
  const panel = $('input-panel');
  ['dragenter', 'dragover'].forEach(t => panel.addEventListener(t, e => { e.preventDefault(); panel.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => panel.addEventListener(t, e => { e.preventDefault(); panel.classList.remove('over'); }));
  panel.addEventListener('drop', e => {
    const f = [...((e as DragEvent).dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/'));
    if (f) byPicture(f); else showError('That doesn’t look like an image. Drop a PNG or JPEG of your Squiggle.');
  });
  window.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
    if (f) byPicture(f);
  });
}

const EXAMPLES: [number, string, string][] = [
  [1234, 'Normal', '0xd553fb67359fc056e93dff5782a863c65889dbb1438f9ee4863cfb319724c685'],
  [7583, 'Perfect Spectrum', '0x583840fc413a729152edfc00e4abd3a6ade316833858a3df2e0245f824a58f37'],
  [3784, 'HyperRainbow Pipe', '0xa4783d287588dfae75c2f9e8fd0481a0c0dad09d246201e8c545015300272919'],
  [102, 'Bold', '0x1db0e2f129b2f4bad06e3e5860357e2c676ce6fedafac40428c0caf128bff424'],
  [1000, 'Slinky', '0xfef2aca5be3fe64a87dfc69b64622cb7377a847c2dc378a3f0ed8be794412b22'],
];
/** an example drawn here from its hash, when Art Blocks' pictures can't be reached */
function drawnThumb(hash: string) {
  const r = portSquiggle(hash, 252), c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  drawDots(c.getContext('2d')!, r);
  return c.toDataURL();
}
for (const [id, what, hash] of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button'; b.title = `Chromie Squiggle #${id} · ${what}`;
  const img = document.createElement('img');
  img.alt = ''; img.width = 84; img.height = 56; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  const drawn = () => { clearTimeout(slow); try { img.src = drawnThumb(hash); } catch { img.style.visibility = 'hidden'; } };
  const slow = setTimeout(() => { if (!img.naturalWidth) drawn(); }, 6000);   // Art Blocks hangs: no error ever comes
  img.onload = () => { if (img.naturalWidth) clearTimeout(slow); };
  img.onerror = () => {
    if (img.src.startsWith('data:')) img.style.visibility = 'hidden';
    else if (!img.src.startsWith(imageUrl(id))) img.src = imageUrl(id);
    else drawn();
  };
  img.src = `https://media-proxy.artblocks.io/1/${SQUIGGLE_CONTRACT}/thumb/${id}.png`;   // Art Blocks' own thumbnail, not hosted here
  const t = document.createElement('span');
  t.innerHTML = `<b>#${id}</b><small>${what}</small>`;
  b.append(img, t);
  b.addEventListener('click', () => byNumber(id));
  $('examples').append(b);
}

// ---------- ① your Squiggle ----------
function showOriginal(l: Loaded) {
  $('original').classList.remove('loading');
  const img = $<HTMLImageElement>('orig-img');
  img.src = l.original; img.hidden = false;
  img.alt = `The original ${squiggleName(l)}`;
  $('orig-title').textContent = squiggleName(l);
  $('orig-origin').textContent = ORIGIN[l.origin];
  const order = ['Type', 'Spectrum', 'Segments', 'Color Direction', 'Height', 'Steps Between', 'Color Spread', 'Start Color', 'End Color'];
  const keys = Object.keys(l.features).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  $('features').innerHTML = keys.map(k => `<div><dt>${esc(k)}</dt><dd>${esc(String(l.features[k]))}</dd></div>`).join('');
  // a traced picture: its features are our reading of it, not Art Blocks' own
  const est = l.origin === 'upload' || l.origin === 'image';
  $('feat-box').classList.toggle('est', est); $('features').classList.toggle('est', est);
  $('feat-est').hidden = !est;
  $('feat-est').textContent = l.origin === 'upload' ? 'Estimated from your picture' : 'Estimated from Art Blocks’ picture';
  const link = $<HTMLAnchorElement>('orig-link');
  link.hidden = l.id === null;
  if (l.id !== null) link.href = `https://www.artblocks.io/token/1/${SQUIGGLE_CONTRACT}/${l.id}`;
  drawCurve(l);
}

/** the line as read: its points in their colours, on the original's canvas */
function drawCurve(l: Loaded) {
  const c = $<HTMLCanvasElement>('curve'), x = c.getContext('2d')!, cv = l.curve, k = c.width / cv.canvas.w;
  c.height = Math.round(cv.canvas.h * k);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.lineCap = 'round'; x.lineWidth = Math.max(2, cv.stroke * k * 0.35);
  const P = cv.points;
  for (let i = 1; i < P.length; i++) {
    x.strokeStyle = `hsl(${P[i].hue} 90% 50%)`;
    x.beginPath(); x.moveTo(P[i - 1].x * k, P[i - 1].y * k); x.lineTo(P[i].x * k, P[i].y * k); x.stroke();
  }
  const f = l.features;
  $('read-text').textContent = [`${cv.type}${f.Spectrum ? ` · ${f.Spectrum} spectrum` : ''}${f.Segments ? ` · ${f.Segments} segments` : ''} · ${P.length.toLocaleString('en')} points along its line, stroke ${Math.round(cv.stroke)} px on a ${cv.canvas.w} × ${cv.canvas.h} canvas.`, ...l.notes].join(' ');
}

async function showChoice() {
  const b = builds;
  if (!b) return;
  const r = request(), my = ++viewGen;
  renderPicker();
  if (!built(b, r)) busy(`Building the ${label(r)}…`);
  let m: SqModel;
  try { m = await b.get(r); } catch (e) {
    if (my === viewGen) { busy(null); showError((e as Error).message); }
    return;
  }
  if (my !== viewGen || b !== builds) return;
  await show(m);
  renderPicker();
  thumbnails();
  // the same display at the other size, in the background: its size shows on the Large | Small switch
  if (r.format === 'relief') setTimeout(() => {
    if (b === builds) b.get({ ...r, scale: r.scale === 'large' ? 'small' : 'large' }).then(() => { if (b === builds) renderPicker(); }, () => {});
  }, 2500);
}
const label = (r: ModelRequest) => r.format === 'mosaic' ? `${r.scale === 'large' ? '96 × 48' : '64 × 32'} Mosaic` : `${r.scale === 'large' ? 'Large' : 'Small'} ${DISPLAY[r.display ?? 'frame']}`;

async function show(m: SqModel) {
  const s = await liveStage();
  if (!builds || built(builds, request()) !== m) return;
  model = m;
  busy(null);
  $('hint').hidden = true; $('reset').hidden = true; $('skip').hidden = false;
  s.setModel(m);
  fitStage(m, s.defaultView);
  if (played.has(m)) s.skip(); else { played.add(m); s.play(); }
  renderStats(m);
  renderChecks(m);
  $('secnav').hidden = false;
  renderBuy(m);
  renderReader(m);
}

/** One column (phones, tablets; the CSS uses --ar below 900 px): the stage takes the shape of the model as seen from the
 *  default view, so a wide Frame or Mosaic leaves no big grey band. On a table the view sways ±18° after the build and
 *  is fitted again all along: the narrowest of those shapes keeps the model the same width throughout. */
function fitStage(m: SqModel, v: { az: number; el: number; margin: number }) {
  const P: [number, number, number][] = [];   // world corners: table (x, y·PL, −z); wall: model z up, y towards the viewer
  for (const p of m.pieces) for (const px of [p.x, p.x + p.w]) for (const py of [p.y, p.y + p.h]) for (const pz of [p.z, p.z + p.d])
    P.push(m.pose === 'wall' ? [px, pz, py * PL] : [px, py * PL, -pz]);
  let r = Infinity;
  for (const turn of m.pose === 'wall' ? [0] : [-18, -12, -6, 0, 6, 12, 18]) {
    const a = (v.az + turn) * Math.PI / 180, e = v.el * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a), se = Math.sin(e), ce = Math.cos(e);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [X, Y, Z] of P) {
      const h = X * ca - Z * sa, u = -X * se * sa + Y * ce - Z * se * ca;   // on the screen's right and up axes
      x0 = Math.min(x0, h); x1 = Math.max(x1, h); y0 = Math.min(y0, u); y1 = Math.max(y1, u);
    }
    r = Math.min(r, (x1 - x0) / Math.max(1e-6, y1 - y0));
  }
  $('view').parentElement!.style.setProperty('--ar', Math.min(2.2, Math.max(1, r / (1 - v.margin))).toFixed(3));
}

function renderPicker() {
  document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.format === choice.format)));
  const relief = choice.format === 'relief', b = builds;
  const opts: [Scale, string, string][] = relief
    ? (['large', 'small'] as Scale[]).map(s => { const m = b?.relief[s]?.[choice.display]; return [s, s === 'large' ? 'Large' : 'Small', m ? sizeText(m) : '…']; })
    : [['large', '96 × 48', '77 × 38 cm'], ['small', '64 × 32', '51 × 26 cm']];
  const cur = relief ? choice.relief : choice.mosaic;
  $('scales').innerHTML = opts.map(([s, t, sub]) => `<button data-scale="${s}" role="radio" aria-checked="${s === cur}">${t} <small>${sub}</small></button>`).join('');
  $('displays').hidden = !relief;
  document.querySelectorAll<HTMLButtonElement>('.disp').forEach(d => d.setAttribute('aria-checked', String(d.dataset.display === choice.display)));
}
document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(b => b.addEventListener('click', () => { choice.format = b.dataset.format as Format; showChoice(); }));
$('scales').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-scale]');
  if (!b) return;
  if (choice.format === 'relief') choice.relief = b.dataset.scale as Scale; else choice.mosaic = b.dataset.scale as Scale;
  showChoice();
});
document.querySelectorAll<HTMLButtonElement>('.disp').forEach(b => b.addEventListener('click', () => { choice.display = b.dataset.display as Display; showChoice(); }));

// the three display thumbnails of the current size: built in the workers, drawn off-screen, kept
const thumbURL = new WeakMap<SqModel, string>();
let thumbStage: Stage | null = null, thumbTimer = 0;
async function thumbOf(m: SqModel): Promise<string> {
  const have = thumbURL.get(m);
  if (have) return have;
  const { Stage } = await stageModule();
  await new Promise(r => setTimeout(r, 0));
  thumbStage ??= new Stage(360, 240);
  thumbStage.setModel(m, { margin: 0.14 });   // the card's rounded corners never cut the Frame or the base
  const url = thumbStage.toDataURL('image/jpeg', 0.86);
  thumbURL.set(m, url);
  clearTimeout(thumbTimer);
  thumbTimer = window.setTimeout(() => { thumbStage?.dispose(); thumbStage = null; }, 4000);   // free its WebGL context
  return url;
}
function thumbnails() {
  const b = builds, scale = choice.relief;
  if (!b) return;
  for (const d of DISPLAYS) {
    const card = document.querySelector<HTMLElement>(`.disp[data-display="${d}"]`)!;
    const img = card.querySelector('img')!, fig = card.querySelector('.dfig')!;
    const m0 = b.relief[scale]?.[d];
    if (!m0 || !thumbURL.has(m0)) { img.hidden = true; card.classList.add('wait'); fig.textContent = ''; }
    b.get({ format: 'relief', display: d, scale }).then(async m => {
      fig.innerHTML = `<i>${m.pieces.length.toLocaleString('en')} pieces</i><i>${sizeText(m)}</i>`;
      const url = await thumbOf(m);
      if (b !== builds || scale !== choice.relief) return;
      img.src = url; img.hidden = false; card.classList.remove('wait');
    }, () => { card.classList.remove('wait'); fig.textContent = 'couldn’t be built'; });
  }
}

function renderStats(m: SqModel) {
  // label, figure, then short groups that wrap whole (no "·" left at a line's end)
  const s = m.subtotals, stat = (k: string, v: string, sub: string[] = []) => `<div class="stat"><span class="k">${k}</span><b>${v}</b>${sub.length ? `<span class="sub">${sub.map(t => `<i>${t}</i>`).join(' ')}</span>` : ''}</div>`;
  const unit = (t: string) => t.replace(/ (kg|g)$/, '<small> $1</small>');
  const dims = m.pose === 'wall' ? 'wide × high' : m.format === 'mosaic' ? 'wide × deep' : 'wide × deep × high';
  $('stats').innerHTML = stat('Pieces', m.pieces.length.toLocaleString('en'), [`${s.squiggle.pieces.toLocaleString('en')} Squiggle`, `+ ${s.display.pieces.toLocaleString('en')} Display`])
    + stat('Size in cm', thin(sizeText(m).replace(/ cm$/, '')), [dims])
    + stat('Weight', `≈ ${unit(kg(m.grams))}`)
    + stat('Estimated cost', `≈ €${m.cost}`, ['at Pick a Brick prices']);
  $('model-sub').innerHTML = `<span>${[loaded ? squiggleName(loaded) : '', ...modelLabel(m).split(' · '), 'built and checked in your browser'].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</span>`;
}

function renderChecks(m: SqModel) {
  const c = m.checks, wall = m.pose === 'wall';
  const li = (cls: string, big: string, small: string) => `<li class="${cls}"><b>${big}</b>${small}</li>`;
  const base = wall ? 'the backing' : 'the base';
  $('checks').innerHTML = [
    li('ok', `${c.connections.toLocaleString('en')} studs`, 'connected between pieces'),
    c.collisions === 0 ? li('ok', '0 collisions', 'no two pieces overlap') : li('bad', `${c.collisions} collisions`, 'some pieces overlap: this model can’t be built as is'),
    c.floating === 0 ? li('ok', '0 floating', `every piece is attached to ${base}`) : li('bad', `${c.floating} floating`, `pieces not attached to ${base}: this model can’t be built as is`),
    c.twoStud === null ? '' : c.twoStud === 0 ? li('ok', 'Held by 2+ studs', 'every piece of the Squiggle') : li('bad', `${c.twoStud} loose`, 'Squiggle pieces held by a single stud'),
    c.comInside === null ? '' : c.comInside ? li('ok', 'Balanced', `centre of mass ${c.com.margin < 1 ? 'just' : Math.round(c.com.margin) === 1 ? '1 stud' : `${Math.round(c.com.margin)} studs`} inside the base`) : li('bad', 'Will tip over', 'the centre of mass is outside the base'),   // whole studs, as its rule
    c.weak === 0 ? li('ok', '0 weak joints', 'no piece hangs on a single stud') : li('warn', `${c.weak} on one stud`, m.format === 'mosaic' ? '1×1 tiles, fine lying flat' : 'fine for display, handle gently'),
  ].join('');
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  $('rules').innerHTML = c.rules.map(r => `<li class="${r.ok ? 'ok' : 'bad'}"><b>${esc(cap(r.name))}</b>${r.detail ? esc(r.detail) : ''}</li>`).join('');
  const ms = builds?.ms[`${m.format}-${m.display ?? ''}-${m.scale}`];
  const took = ms === undefined ? '' : ms < 50 ? ' in under 0.1 s' : ` in ${(ms / 1000).toFixed(1)} s`;   // a model from the shared ribbon takes a few ms: not "0.0 s"
  $('notes').innerHTML = [...m.notes, `Computed in your browser${took}. Computer-checked, not physically built.`].map(n => `<li>${esc(n)}</li>`).join('');
  const failed = c.rules.filter(r => !r.ok).length;
  const solid = c.floating === 0 && c.collisions === 0 && !c.twoStud && c.comInside !== false && !failed;
  const pill = $('pill');
  pill.className = solid ? 'pill' : 'pill bad';
  pill.textContent = solid ? '✓ Checked: solid' : '✗ Check failed';
  $('status-short').textContent = `${c.floating} floating · ${c.collisions} collisions · ${failed ? `${failed} rule${failed > 1 ? 's' : ''} failed` : `all ${c.rules.length} rules met`}`;
}

// ---------- exports ----------
function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
function progress(text: string | null, f = 0) {
  $('progress').hidden = text === null;
  if (text !== null) { $('progress-text').textContent = text; $('bar').style.width = `${Math.round(f * 100)}%`; }
}
let exporting = false;
const actButtons = () => document.querySelectorAll<HTMLButtonElement>('.act-btn');
async function run(what: string, job: (m: SqModel, l: Loaded) => Promise<void>) {
  const m = model, l = loaded;
  if (exporting || !m || !l) return;
  exporting = true;
  actButtons().forEach(b => { b.disabled = true; });
  try { await job(m, l); progress(null); }
  catch (e) { progress(`${what} failed: ${(e as Error).message}`, 0); setTimeout(() => progress(null), 6000); }
  finally { exporting = false; actButtons().forEach(b => { b.disabled = false; }); }
}
const quality = isPhone ? 1 : 1.5;
const booklet = async (m: SqModel, l: Loaded) => {
  progress('Drawing the instructions…', 0);
  return makeBooklet(m, l, (d, t) => progress(`Drawing page ${d} of ${t}…`, d / t), { quality });
};
$('dl-pdf').addEventListener('click', () => run('Instructions', async (m, l) => save(await booklet(m, l), `${fileBase(m, l)}-instructions.pdf`)));
$('dl-kit').addEventListener('click', () => run('Kit', async (m, l) => {
  const pdf = await booklet(m, l);
  progress('Packing the kit: nameplate, share image, lists…', 1);
  save(await makeKit(m, l, pdf), `${fileBase(m, l)}-kit.zip`);
}));
for (const format of ['square', 'story'] as const) $(format === 'square' ? 'vid-square' : 'vid-story').addEventListener('click', () => run('Video', async (m, l) => {
  const { recordVideo } = await import('./squiggle/video');
  progress('Preparing the video…', 0);
  const { blob, ext } = await recordVideo(m, l, { format, small: isPhone,
    onProgress: (stage, f) => progress(stage === 'preparing' ? 'Preparing the video…' : 'Recording the video (23 s)… keep this tab open', f) });
  save(blob, `${fileBase(m, l)}-${format === 'story' ? '9x16' : 'square'}.${ext}`);
}));
$('dl-nameplate').addEventListener('click', () => run('Nameplate', async (m, l) => {
  progress('Drawing the nameplate at 600 dpi…', 0.5);
  save((await nameplateFiles(m)).cutMarks, `${fileBase(m, l)}-nameplate-cut-marks.png`);
}));
$('dl-share').addEventListener('click', () => run('Share image', async (m, l) => {
  progress('Drawing the share image…', 0.5);
  save(await shareImage(m, l), `${fileBase(m, l)}-share.png`);
}));
function shareLink() {
  const m = model, l = loaded;
  const text = m && l
    ? `I turned ${l.id !== null ? `Chromie Squiggle #${l.id}` : 'my Chromie Squiggle'} into a ${m.pieces.length.toLocaleString('en')}-piece brick ${m.format === 'mosaic' ? 'Mosaic' : DISPLAY[m.display ?? 'frame']} you can really build 🧱\n\nMade with Squiggle to Bricks, inspired by @victormustar's Microduck.`
    : 'Build your Chromie Squiggle with real bricks 🧱';
  const url = new URL(location.origin + location.pathname);
  if (l?.id != null) url.searchParams.set('id', String(l.id));
  $<HTMLAnchorElement>('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url.href)}`;
}
$('share-x').addEventListener('pointerdown', shareLink);
$('share-x').addEventListener('focus', shareLink);

// ---------- ② instructions reader: pages are drawn only when looked at ----------
let maker: SqPageMaker | null = null, pageNo = 1, pageReq = 0;
let thumbObserver: IntersectionObserver | null = null;
const drawn = new Set<number>();
function drawThumb(n: number, pg: HTMLCanvasElement) {
  const c = $('thumbs').querySelector<HTMLCanvasElement>(`[data-n="${n}"] canvas`);
  if (c) { c.getContext('2d')!.drawImage(pg, 0, 0, c.width, c.height); drawn.add(n); }
}
function renderReader(m: SqModel) {
  if (!loaded) return;
  maker?.dispose();
  const mk = maker = new SqPageMaker(m, loaded, { quality });
  drawn.clear();
  $<HTMLInputElement>('pg-range').max = String(mk.total);
  $<HTMLInputElement>('pg-range').value = '1'; $('pg-label').textContent = mk.label(1); pageNo = 1;
  $('manual-sub').textContent = `${m.steps.length} steps · ${mk.total} pages · ${modelLabel(m)}`;
  $('pdf-note').textContent = `PDF · ${mk.total} pages · A4, nameplate at real size`;
  thumbObserver?.disconnect();
  const strip = $('thumbs'); strip.innerHTML = '';
  const queue: number[] = [];
  let busyDrawing = false;
  const drain = async () => {
    if (busyDrawing) return;
    busyDrawing = true;
    while (queue.length && maker === mk) {
      const n = queue.shift()!;
      if (drawn.has(n)) continue;
      await new Promise(r => setTimeout(r, 30));
      try { const pg = await mk.page(n); if (maker === mk) drawThumb(n, pg); } catch { /* next */ }
    }
    busyDrawing = false;
  };
  thumbObserver = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    thumbObserver!.unobserve(e.target); queue.push(+(e.target as HTMLElement).dataset.n!); drain();
  }), { root: strip, rootMargin: '0px 240px' });
  const buttons = Array.from({ length: mk.total }, (_, i) => {
    const b = document.createElement('button');
    b.dataset.n = String(i + 1);
    const c = document.createElement('canvas'); c.width = 224; c.height = 158;
    b.append(c, mk.label(i + 1));
    b.addEventListener('click', () => showPage(i + 1));
    return b;
  });
  strip.append(...buttons);
  const c = $<HTMLCanvasElement>('page-canvas'), x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  // pages are drawn once the reader comes near the screen: not during the build animation up there
  readerStart = () => { if (maker !== mk) return; buttons.forEach(b => thumbObserver!.observe(b)); showPage(1); };
  if (readerNear) { readerStart(); readerStart = null; }
}
let readerNear = false, readerStart: (() => void) | null = null;
new IntersectionObserver(es => {
  readerNear = es[es.length - 1].isIntersecting;
  if (readerNear && readerStart) { const go = readerStart; readerStart = null; go(); }
}, { rootMargin: '500px 0px' }).observe($('sec-manual'));
async function showPage(n: number) {
  const mk = maker;
  if (!mk) return;
  pageNo = Math.max(1, Math.min(mk.total, n));
  const my = ++pageReq, at = pageNo;
  $<HTMLInputElement>('pg-range').value = String(at);
  $('pg-label').textContent = `${mk.label(at)}${mk.kind(at) === 'step' ? ` of ${mk.steps}` : ''}`;
  $<HTMLButtonElement>('pg-prev').disabled = at === 1;
  $<HTMLButtonElement>('pg-next').disabled = at === mk.total;
  const strip = $('thumbs');
  strip.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n! === at));
  const on = strip.querySelector<HTMLElement>(`[data-n="${at}"]`);
  if (on) strip.scrollTo({ left: on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2, behavior: 'smooth' });
  const spin = setTimeout(() => { $('pg-busy').hidden = false; }, 150);
  try {
    const pg = await mk.page(at);
    if (my !== pageReq || mk !== maker) return;
    const c = $<HTMLCanvasElement>('page-canvas');
    c.getContext('2d')!.drawImage(pg, 0, 0, c.width, c.height);
    if (!drawn.has(at)) drawThumb(at, pg);
  } catch { /* a page that fails leaves the previous one */ }
  finally { if (my === pageReq) { clearTimeout(spin); $('pg-busy').hidden = true; } }
}
$('pg-prev').addEventListener('click', () => showPage(pageNo - 1));
$('pg-next').addEventListener('click', () => showPage(pageNo + 1));
$('pg-range').addEventListener('input', e => showPage(+(e.target as HTMLInputElement).value));
$('page-view').tabIndex = 0;
$('page-view').addEventListener('keydown', e => { if (e.key === 'ArrowRight') showPage(pageNo + 1); if (e.key === 'ArrowLeft') showPage(pageNo - 1); });
{ // swipe on phones: the page keeps its vertical scroll (touch-action pan-y); a sideways swipe turns it, even when the
  // browser cancels the touch half-way (it took it for a scroll or a pinch): the last move decides
  const pv = $('page-view');
  let from: [number, number] | null = null, to: [number, number] = [0, 0];
  const fingers = new Set<number>();
  const turn = () => {
    if (!from) return;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    from = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.3 * Math.abs(dy)) showPage(pageNo + (dx < 0 ? 1 : -1));
  };
  pv.addEventListener('pointerdown', e => {
    if (e.isPrimary) fingers.clear();
    fingers.add(e.pointerId);
    from = fingers.size === 1 && e.button === 0 ? [e.clientX, e.clientY] : null;   // two fingers: a pinch, no swipe
    to = [e.clientX, e.clientY];
  });
  pv.addEventListener('pointermove', e => { if (from) to = [e.clientX, e.clientY]; });
  const end = (e: PointerEvent) => { if (fingers.delete(e.pointerId) && from) { to = [e.clientX || to[0], e.clientY || to[1]]; turn(); } };
  pv.addEventListener('pointerup', end);
  pv.addEventListener('pointercancel', e => { fingers.delete(e.pointerId); turn(); });   // a cancel's position is 0, 0: the last move stands
}

// ---------- ③ buy the bricks ----------
function lotEl(b: SqBomLine) {
  const lot = document.createElement('div'); lot.className = 'lot';
  const eid = elementId(b.part, b.color);
  lot.title = `${b.qty}× ${times(b.name)}, ${b.colorName} · BrickLink ${brickLinkId(b.part)} · ${eid ? `LEGO Element ${eid}` : 'not sold at LEGO'}${b.hidden ? ' · hidden support' : ''}`;
  const c = document.createElement('canvas'); c.width = 112; c.height = 88;
  partIcon(c.getContext('2d')!, 56, 44, b.kind, b.w, b.d, b.h, b.color, 92, 72);
  const t = document.createElement('span');
  const [, kind, size] = times(b.name).replace(/ with Holes$/, '').match(/^(.*?)\s*(\d+×\d+)?$/)!;
  t.innerHTML = `<span class="q">${b.qty}x</span><small class="nm">${esc(kind)}${size ? ` <span class="sz">${size}</span>` : ''}</small><small>${esc(b.colorName)}</small>${b.hidden ? '<small>hidden support</small>' : ''}`;
  lot.append(c, t);
  if (!eid) { const dot = document.createElement('i'); dot.className = 'dot bl'; lot.append(dot); }
  return lot;
}
function renderBuy(m: SqModel) {
  const s = orderSummary(m), total = m.bom.length, pcs = m.pieces.length.toLocaleString('en'), missing = s.brickLinkOnly.length;
  $('shop-sum').textContent = `${total} lots · ${pcs} pieces`;
  const row = (name: string, lots: number, pieces: number, grams: number, cost: number, cls = '') =>
    `<div class="st${cls}"><b>${name}</b><span>${lots} lots</span><span>${pieces.toLocaleString('en')} pieces</span><span class="g">${kg(grams)}</span><span>≈ €${cost}</span></div>`;
  const q = m.subtotals.squiggle, d = m.subtotals.display;
  $('subtot').innerHTML = row('Squiggle', q.lots, q.pieces, q.grams, q.cost) + row('Display', d.lots, d.pieces, d.grams, d.cost) + row('Total', total, m.pieces.length, m.grams, m.cost, ' total');
  const g = $('shop-grid'); g.innerHTML = '';
  for (const role of ['squiggle', 'display'] as const) {
    const lines = m.bom.filter(l => l.role === role), st = m.subtotals[role];
    if (!lines.length) continue;
    const h = document.createElement('div'); h.className = 'shop-sec';
    h.innerHTML = `<b>${role === 'squiggle' ? 'Squiggle' : 'Display'}</b><span>${st.lots} lots · ${st.pieces.toLocaleString('en')} pieces · ${kg(st.grams)} · ≈ €${st.cost}</span>`;
    g.append(h, ...lines.map(lotEl));
  }
  const more = $('shop-more');
  more.hidden = total <= 8;
  $('shoplist').classList.remove('open');
  more.textContent = `See all ${total} lots ▾`;
  $('shop-keys').innerHTML = missing
    ? `<i class="dot bl"></i> ${missing} lot${missing > 1 ? 's' : ''} LEGO doesn’t sell: get ${missing > 1 ? 'them' : 'it'} on BrickLink`
    : 'Every lot has a LEGO Element ID: all of it can be ordered on Pick a Brick, or on BrickLink.';
  $('lego-n').textContent = String(s.lego.length);
  $('lego-total').textContent = missing ? `/${total} lots` : ' lots';
  $<HTMLButtonElement>('buy-lego').disabled = s.lego.length === 0;
  $('lego-guide').hidden = true;
  const files = pickABrickFiles(m).length;
  $('lego-line').textContent = `${files > 1 ? `${files} files` : 'One file'} for “Upload List” · ${s.legoPieces.toLocaleString('en')} pieces`;
  $('bl-n').textContent = String(total);
  $('bl-total').textContent = ' lots';
  $('bl-sub').innerHTML = `Independent shops<span class="sub2"> · ${missing ? 'every lot, the rest too' : 'if LEGO runs out'}</span>`;   // a narrow button keeps the first part
  $('bl-after').hidden = true;
  $('pab-files').textContent = files > 1 ? `${files} files, 400 references each at most` : 'one CSV file';
}
$('shop-more').addEventListener('click', () => {
  const open = $('shoplist').classList.toggle('open');
  $('shop-more').textContent = open ? 'Show less ▴' : `See all ${model?.bom.length ?? ''} lots ▾`;
});
/** The "Before you order" notice, once per visit, before the first order file. */
let understood = false;
function beforeOrder(): Promise<boolean> {
  if (understood) return Promise.resolve(true);
  const d = $<HTMLDialogElement>('before-order'), ok = $<HTMLInputElement>('bo-ok'), go = $<HTMLButtonElement>('bo-continue');
  ok.checked = false; go.disabled = true;
  ok.onchange = () => { go.disabled = !ok.checked; };
  d.showModal();
  return new Promise(res => { d.onclose = () => { understood = d.returnValue === 'ok' && ok.checked; res(understood); }; });
}
async function orderAction(make: (m: SqModel, l: Loaded) => void | Promise<void>) {
  const m = model, l = loaded;
  if (m && l && await beforeOrder()) await make(m, l);
}
const downloadLego = (m: SqModel, l: Loaded) => {
  const files = pickABrickFiles(m), names = pickABrickNames(m, l, files.length);
  files.forEach((f, i) => setTimeout(() => save(new Blob([f], { type: 'text/csv' }), names[i]), i * 400));
  return names;
};
$('buy-lego').addEventListener('click', () => orderAction((m, l) => {
  const names = downloadLego(m, l);
  $('lego-file').textContent = names.length > 1
    ? `${names.length} files saved to your Downloads (${names[0]} …): upload them one after the other`
    : `${names[0]} · saved to your Downloads`;
  const g = $('lego-guide'); g.hidden = false;
  g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}));
$('lego-again').addEventListener('click', () => orderAction((m, l) => { downloadLego(m, l); }));
$('buy-bl').addEventListener('click', () => orderAction(async (m, l) => {
  const xml = brickLinkXML(m);
  let copied = true;
  try { await navigator.clipboard.writeText(xml); } catch { copied = false; save(new Blob([xml], { type: 'application/xml' }), `${fileBase(m, l)}-bricklink.xml`); }
  $('bl-after-text').textContent = copied ? `List copied (all ${m.bom.length} lots)` : 'Couldn’t copy: list downloaded instead (open it and copy its text)';
  $('bl-after').hidden = false;
}));
$('dl-pab').addEventListener('click', () => orderAction((m, l) => { downloadLego(m, l); }));
$('dl-xml').addEventListener('click', () => orderAction((m, l) => save(new Blob([brickLinkXML(m)], { type: 'application/xml' }), `${fileBase(m, l)}-bricklink.xml`)));
$('dl-csv').addEventListener('click', () => { if (model && loaded) save(new Blob([partsCSV(model)], { type: 'text/csv' }), `${fileBase(model, loaded)}-parts.csv`); });

// ---------- panels ----------
function busy(text: string | null) {
  $('busy').hidden = text === null;
  $('stage-btns').hidden = text !== null;
  if (text) $('busy-text').textContent = text;
}
function showError(msg: string | null, offerUpload = false) {
  $('error').hidden = !msg;
  $('error-text').textContent = msg ?? '';
  $('error-upload').hidden = !offerUpload;
  if (msg) $('error').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
$('replay').addEventListener('click', () => { $('hint').hidden = true; $('reset').hidden = true; $('skip').hidden = false; stage?.play(); });
$('skip').addEventListener('click', () => stage?.skip());
$('reset').addEventListener('click', () => { stage?.resetView(); $('reset').hidden = true; });

// ---------- sticky section menu ----------
const secLinks = [...document.querySelectorAll<HTMLAnchorElement>('#secnav a')];
secLinks.forEach(a => a.addEventListener('click', e => {   // scrolls, without a history entry
  e.preventDefault();
  $(a.dataset.sec!).scrollIntoView({ behavior: 'smooth', block: 'start' });
}));
const secObserver = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) secLinks.forEach(a => a.classList.toggle('on', a.dataset.sec === e.target.id));
}, { rootMargin: '-45% 0px -50% 0px' });
['sec-model', 'sec-manual', 'sec-buy'].forEach(id => secObserver.observe($(id)));

// a link to a Squiggle (?id=1234) builds it; three.js loads early when the page is idle
{
  const id = urlId(), raw = new URLSearchParams(location.search).get('id');
  if (id !== null) byNumber(id, 'replace');
  else {
    if (raw !== null) {   // a mistyped link says so
      num.value = raw.slice(0, 12);
      showError(raw.trim() ? `This link asks for Squiggle #${raw.trim().replace(/^#/, '').slice(0, 12)}, which doesn’t exist. Type a Squiggle number from 0 to 9999.` : 'This link has no Squiggle number. Type one from 0 to 9999.');
    }
    setTimeout(() => { stageModule(); }, 1500);
  }
}

// dev/test hook: lets scripts reach the page's state
if (import.meta.env.DEV) {
  Object.assign(window, { stb: { get stage() { return stage; }, get model() { return model; }, get loaded() { return loaded; }, get builds() { return builds; }, get maker() { return maker; }, choice, showChoice, byNumber } });
}
