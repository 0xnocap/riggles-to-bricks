// Renders of a Squiggle model, staged like a product shot: light grey studio,
// soft shadows, on a table or hung on a wall. Two modes: off-screen at a fixed
// size (stills, booklet, video frames), or live in a page canvas sized by its CSS
// box, with orbit controls, rendered on demand only. The build animation
// (timeline.ts) brings the pieces in step by step: dropped onto the table, or
// pressed onto the hung panel from the viewer's side; a piece fading in on its way
// (the Mosaic's) is drawn on its own, see-through. Shadows are redrawn only when
// pieces move (the lights turn with the model, not with the camera).
// The key light's soft (VSM) shadow shapes the relief and drops on the wall; on a
// table a blurred footprint grounds the model, and a Backdrop's wall gets a soft
// decal shadow of the ribbon (a real light would drop it on the socle, or out of
// sight behind the ribbon). A stud shows until a piece lands on it, and off-screen
// renders up to 1600 px wide and the live view (but on phones) are supersampled 2×:
// hidden studs and the thin joints between pieces would otherwise alias into dotted
// moiré. For the same reason the live view stacks plates almost touching and, far
// off, shades the rounded edges along their joints like the sides. The Frame's white
// panel plates butt with a hairline joint: at the usual joint the black backing
// under them would draw a grey grid over the picture.
// A hung model is built under an oblique camera (from the front its layers would hide
// each other), turning to face it at the end. In a page, a vertical swipe on the view
// scrolls the page; the model turns to horizontal drags, zooms to a pinch.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLOR_BY_ID, renderHex, TRANS_CLEAR } from '../core/palette';
import type { Piece } from '../core/parts';
import { geoKey, pieceGeometry, studCells, studGeometry } from '../viewer/geometry';
import type { SqModel } from './model';
import { nameplateCanvas } from './nameplate';
import { WHITE } from './spectrum';
import { buildTurn, ease, easeIO, makeTimeline, pieceState, PL, type SqTimeline, type TimelineOptions } from './timeline';

export const STAGE_BG = '#e8e9eb';
/** Backdrop wall shadow: offset per stud of distance to the wall (x right, y up: a light from the front left, from
 *  above but lower than the camera, so the shadow shows just above the ribbon's back edge), [blur in studs, alpha]
 *  passes, and the opacity of what lies more than `far` studs from the wall (the front half would smear the band) */
const WALL_LIGHT = { x: 0.12, y: -0.2, blur: [[0.3, 0.26], [1.1, 0.16]] as [number, number][], far: 10, farAlpha: 0.45 };
/** the Backdrop's wall faces the camera, away from the high key light: a soft light of its own keeps it white */
const WALL_GLOW = 0.4;
const MAX_GHOSTS = 96, GHOST_ALPHA = [0.3, 0.16, 0.07];
/** live view: pixels drawn at most when supersampling (a large canvas gets less than 2×, never less than its pixel ratio) */
const LIVE_PX = 4.5e6;

/** camera azimuth (deg, + = from the right), elevation (deg, + = from above), vertical field, framing margin (0..1) */
export interface View { az: number; el: number; fov: number; margin: number }

/** the page's camera at the start of the build: [azimuth, elevation, margin] added to the default view */
const BUILD_VIEW = { wall: [-30, 20, 0.05], mosaic: [-14, 8, 0.05], table: [-24, 10, 0.05] };

export function defaultView(m: SqModel): View {
  if (m.pose === 'wall') return { az: -5, el: 4, fov: 22, margin: 0.1 };
  if (m.format === 'mosaic') return { az: 0, el: 65, fov: 24, margin: 0.06 };
  if (m.display === 'backdrop') return { az: -20, el: 32, fov: 26, margin: 0.06 };
  return { az: -22, el: 40, fov: 26, margin: 0.06 };
}

export interface StageOptions {
  /** render scale: off-screen 2 up to 1600 px wide, else 1; live 2 (the browser scales the canvas down: seams
   *  between stacked plates would alias into dotted moiré at 1) within LIVE_PX, on low-power devices the pixel
   *  ratio (at most 2) */
  supersample?: number;
  /** phones: smaller shadow maps, live at the pixel ratio (no supersampling on a 1× screen) */
  lowPower?: boolean;
  /** motion trails above falling pieces (table poses only: on a wall they would come at the viewer) */
  ghosts?: boolean;
  /** build animation length etc. (timeline.ts) */
  timeline?: TimelineOptions;
  /** live: after the build, a slow sway round the default view until the visitor takes over (table poses; never
   *  on the Frame, which stays square to its wall) */
  autoRotate?: boolean;
}

/** where the camera is: looking at `target` from direction `dir` (unit, world), `dist` away */
export interface Shot { target: THREE.Vector3; dir: THREE.Vector3; dist: number; fov: number }

interface StudSet { mesh: THREE.InstancedMesh; owner: Int32Array; cover: Int32Array; at: Float32Array }
interface Tween { t0: number; ms: number; from: Shot; to: Shot }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
/** Live view: far off, the rounded edges between a piece's sides and its top or bottom shade like the side. Thinner than
 *  a pixel, the light and dark lines they draw along every joint of stacked plates alias into dotted moiré.
 *  [start, full] in view units per pixel. */
const FLAT_EDGES = [0.04, 0.14];
function flattenFarEdges(mat: THREE.Material) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvObjN = objectNormal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform mat4 modelMatrix;\nvarying vec3 vObjN;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      { vec3 a = abs(normalize(vObjN));
        if (a.y > 0.02 && a.y < 0.995) {
          vec3 f = a.x > a.z ? vec3(sign(vObjN.x), 0., 0.) : vec3(0., 0., sign(vObjN.z));
          normal = normalize(mix(normal, normalize((viewMatrix * modelMatrix * vec4(f, 0.)).xyz), smoothstep(${FLAT_EDGES[0].toFixed(3)}, ${FLAT_EDGES[1].toFixed(3)}, length(fwidth(vViewPosition)))));
          nonPerturbedNormal = normal;
        } }`);
  };
  mat.customProgramCacheKey = () => 'flat-far-edges';
}
/** how far points (x, y) reach into a rectangle [x0, y0, x1, y1]: ≤ 0 when none is inside */
function into(xs: Float32Array, ys: Float32Array, [x0, y0, x1, y1]: [number, number, number, number]): number {
  let r = -Infinity;
  for (let i = 0; i < xs.length; i++) r = Math.max(r, Math.min(xs[i] - x0, x1 - xs[i], ys[i] - y0, y1 - ys[i]));
  return r;
}
const dirOf = (az: number, el: number) => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(26, 1.5, 0.1, 5000);
  /** live mode only */
  readonly controls: OrbitControls | null = null;
  readonly live: boolean;
  model: SqModel | null = null;
  tl: SqTimeline | null = null;
  /** live mode: called when the build animation ends (or is skipped) */
  onFinished: (() => void) | null = null;
  /** live mode: called when the visitor turns or zooms the model (not on a swipe that scrolls the page) */
  onTakeOver: (() => void) | null = null;
  private opts: StageOptions;
  private mount = new THREE.Group();         // table or wall orientation
  private root = new THREE.Group();          // model frame: x, y·PL, −z
  private key = new THREE.DirectionalLight(0xffffff, 2.6);     // shapes the relief, casts soft shadows
  private soft = new THREE.DirectionalLight(0xffffff, 0.45);   // fill from the other side, no shadow
  private ground: THREE.Mesh;
  private blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  private mats = new Map<number, THREE.Material>();
  private holeMat = new THREE.MeshStandardMaterial({ color: '#070707', roughness: 0.9 });
  private wallMat = new THREE.MeshStandardMaterial({ color: renderHex(WHITE), roughness: 0.28, metalness: 0, emissive: renderHex(WHITE), emissiveIntensity: WALL_GLOW });
  private disposables: { dispose(): void }[] = [];
  private box = new THREE.BoxGeometry(1, 1, 1);
  private casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private ss = 1;                             // render scale of the current size
  private view: View = { az: 0, el: 30, fov: 26, margin: 0.08 };
  private homeView: View = this.view;
  private pts: THREE.Vector3[] = [];
  private bounds = new THREE.Box3();          // world box of the model, for the orbit target
  // build animation
  private slots: [THREE.InstancedMesh, number][] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private home = new Float32Array(0);         // root-frame centre-bottom of each piece
  private casterOf = new Int32Array(0);
  private caster: THREE.InstancedMesh | null = null;
  private studSets: StudSet[] = [];
  private ghostSets = new Map<number, THREE.InstancedMesh[]>();
  private np: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; i: number; y: number } | null = null;
  private fades: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];   // pieces fading in
  private decal: THREE.MeshBasicMaterial | null = null;
  private state = new Uint8Array(0);          // 0 not yet, 1 on its way, 2 in place
  private off = new Float32Array(0);
  private m4 = new THREE.Matrix4();
  private t = Infinity;
  // live mode
  private playing = false;
  private t0 = 0;
  private userMoved = false;
  private tween: Tween | null = null;
  private grab = false;                       // a pointer is down on the view
  private placed = new THREE.Vector3();       // where the page last put the camera
  private raf = 0;
  private onScreen = true;
  private observers: { disconnect(): void }[] = [];
  private sway = { on: false, t: 0, last: 0 };
  private ownCanvas: boolean;

  /** Live, in a page: sized by the canvas's CSS box, orbit controls, render on demand. */
  constructor(canvas: HTMLCanvasElement, opts?: StageOptions);
  /** Off-screen at a fixed size (the canvas is created if not given). */
  constructor(width: number, height: number, canvas?: HTMLCanvasElement, opts?: StageOptions);
  constructor(a: number | HTMLCanvasElement, b?: number | StageOptions, c?: HTMLCanvasElement, d: StageOptions = {}) {
    this.live = typeof a !== 'number';
    const canvas = typeof a !== 'number' ? a : c ?? document.createElement('canvas');
    this.ownCanvas = typeof a === 'number' && !c;
    this.opts = (typeof a !== 'number' ? (b as StageOptions | undefined) : d) ?? {};
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    if (this.live) flattenFarEdges(this.wallMat);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    // the shadows are redrawn only when pieces move (pose())
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(STAGE_BG);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pm.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.25));
    this.key.castShadow = true;
    this.key.shadow.blurSamples = 16;
    this.key.shadow.bias = -0.0003;
    this.scene.add(this.key, this.key.target, this.soft, this.soft.target);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x1c232b, opacity: 0.28 }));
    this.ground.receiveShadow = true;
    this.mount.add(this.root);
    this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = -1;
    this.scene.add(this.ground, this.blob, this.mount);
    if (typeof a !== 'number') {
      const ctl = new OrbitControls(this.camera, canvas);
      ctl.enableDamping = true; ctl.dampingFactor = 0.09;
      ctl.rotateSpeed = 0.7; ctl.zoomSpeed = 0.8; ctl.screenSpacePanning = true;
      // the visitor takes over once the camera really moves under a pointer (a swipe the browser takes to scroll the
      // page does not count)
      ctl.addEventListener('start', () => { this.grab = true; this.request(); });
      ctl.addEventListener('end', () => { this.grab = false; });
      ctl.addEventListener('change', () => {
        if (this.grab && !this.userMoved && this.camera.position.distanceToSquared(this.placed) > 1e-8) {
          this.userMoved = true; this.tween = null; this.sway.on = false; this.onTakeOver?.();
        }
        this.constrain(); this.request();
      });
      // one finger: the browser scrolls the page on a vertical swipe (OrbitControls sets 'none'), and the controls see
      // the finger only once it goes sideways, else its first moves would tilt the model as the page starts to scroll
      canvas.style.touchAction = 'pan-y';
      const touches = new Set<number>(), wait = new Map<number, [number, number]>();
      const down = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        touches.add(e.pointerId);
        if (touches.size === 1) wait.set(e.pointerId, [e.clientX, e.clientY]); else wait.clear();   // two: a pinch
      };
      const move = (e: PointerEvent) => {
        const w = wait.get(e.pointerId);
        if (!w) return;
        const dx = e.clientX - w[0], dy = e.clientY - w[1];
        if (Math.abs(dx) > Math.abs(dy) && Math.hypot(dx, dy) > 6) wait.delete(e.pointerId); else e.stopImmediatePropagation();
      };
      const up = (e: PointerEvent) => { touches.delete(e.pointerId); wait.delete(e.pointerId); };
      canvas.addEventListener('pointerdown', down, true);
      addEventListener('pointermove', move, true);
      addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
      this.observers.push({ disconnect: () => { canvas.removeEventListener('pointerdown', down, true); removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true); } });
      (this as { controls: OrbitControls | null }).controls = ctl;
      const ro = new ResizeObserver(() => this.setSize(canvas.clientWidth, canvas.clientHeight));
      ro.observe(canvas);
      const io = new IntersectionObserver(es => {
        this.onScreen = es[es.length - 1].isIntersecting;
        if (this.onScreen) { this.sway.last = performance.now(); this.request(); }
      });
      io.observe(canvas);
      this.observers.push(ro, io);
      this.setSize(canvas.clientWidth, canvas.clientHeight);
    } else this.setSize(a, b as number);
  }

  setSize(w: number, h: number) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const dpr = this.live ? window.devicePixelRatio || 1 : 1;
    this.ss = this.live ? Math.min(this.opts.supersample ?? (this.opts.lowPower ? dpr : Math.max(dpr, Math.sqrt(LIVE_PX / (w * h)))), 2) : this.opts.supersample ?? (w <= 1600 ? 2 : 1);
    this.renderer.setPixelRatio(this.ss);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.limits();
    if (this.model && !this.userMoved && !this.tween) this.frame(this.playing ? this.buildView((performance.now() - this.t0) / 1000) : this.view);
    this.request();
  }

  private mat(c: number): THREE.Material {
    let m = this.mats.get(c);
    if (!m) {
      const col = COLOR_BY_ID.get(c)!;
      m = c === TRANS_CLEAR
        // clear plastic over black reads dark: strong reflections keep its edges bright (envMap set, else three ignores envMapIntensity)
        ? new THREE.MeshPhysicalMaterial({
          color: '#ffffff', transmission: 1, thickness: 0.3, attenuationColor: '#ffffff', ior: 1.5, roughness: 0.02, specularIntensity: 1,
          clearcoat: 1, clearcoatRoughness: 0.05, envMap: this.scene.environment, envMapIntensity: 2,
        })
        : col.trans
          ? new THREE.MeshPhysicalMaterial({ color: renderHex(c), transmission: 0.85, thickness: 0.6, roughness: 0.05 })
          : new THREE.MeshStandardMaterial({ color: renderHex(c), roughness: 0.28, metalness: 0 });
      if (this.live && !col.trans) flattenFarEdges(m);
      this.mats.set(c, m);
    }
    return m;
  }

  private clear() {
    this.root.clear();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.fades.forEach(f => f.material.dispose()); this.fades = [];
    this.slots = []; this.meshes = []; this.studSets = []; this.ghostSets.clear(); this.np = null; this.decal = null; this.caster = null;
  }

  setModel(m: SqModel, view: Partial<View> = {}) {
    this.clear();
    this.model = m;
    this.playing = false; this.tween = null; this.userMoved = false; this.sway.on = false;
    const P = m.pieces, n = P.length, wall = m.pose === 'wall';
    this.tl = makeTimeline(m, this.opts.timeline);
    this.state = new Uint8Array(n); this.off = new Float32Array(n);
    this.home = new Float32Array(3 * n);
    P.forEach((p, i) => this.home.set([p.x + p.w / 2, p.y * PL, -(p.z + p.d / 2)], 3 * i));
    // pieces by shape and material (the Backdrop's wall has its own)
    const wallPiece = (p: Piece) => m.display === 'backdrop' && p.c === WHITE && p.role === 'display' && (p.kind === 'brick' || p.kind === 'tile');
    const panel = (p: Piece) => wall && p.c === WHITE && p.role === 'display' && p.kind === 'plate';
    const groups = new Map<string, number[]>();
    P.forEach((p, i) => { const k = `${geoKey(p)}|${p.c}|${+wallPiece(p)}|${+panel(p)}`; groups.set(k, [...(groups.get(k) ?? []), i]); });
    this.slots = new Array(n);
    for (const ids of groups.values()) {
      const p0 = P[ids[0]], geo = pieceGeometry(p0, false, false, this.live, panel(p0)), body = wallPiece(p0) ? this.wallMat : this.mat(p0.c);
      const mesh = new THREE.InstancedMesh(geo, geo.groups.length > 1 ? [body, this.holeMat] : body, ids.length);
      ids.forEach((i, j) => { this.slots[i] = [mesh, j]; });
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.root.add(mesh); this.disposables.push(mesh); this.meshes.push(mesh);
    }
    // every stud, shown until a piece lands on it
    const byColor = new Map<number, ReturnType<typeof studCells>>();
    for (const s of studCells(P)) { if (!byColor.has(s.c)) byColor.set(s.c, []); byColor.get(s.c)!.push(s); }
    for (const [c, list] of byColor) {
      const mesh = new THREE.InstancedMesh(studGeometry(), this.mat(c), list.length);
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.studSets.push({ mesh, owner: Int32Array.from(list, s => s.owner), cover: Int32Array.from(list, s => s.cover), at: Float32Array.from(list.flatMap(s => [s.x, s.y * PL, -s.z])) });
      this.root.add(mesh); this.disposables.push(mesh);
    }
    // shadows come from plain boxes (no studs): studs would speckle the soft shadow map
    const solid = P.map((_, i) => i).filter(i => !COLOR_BY_ID.get(P[i].c)!.trans);
    this.casterOf = new Int32Array(n).fill(-1);
    solid.forEach((i, j) => { this.casterOf[i] = j; });
    const caster = this.caster = new THREE.InstancedMesh(this.box, this.casterMat, Math.max(1, solid.length));
    caster.count = solid.length; caster.castShadow = true; caster.frustumCulled = false;
    this.root.add(caster); this.disposables.push(caster);
    if (this.opts.ghosts && !wall) for (const c of new Set(P.map(p => p.c))) {
      this.ghostSets.set(c, GHOST_ALPHA.map(o => {
        const mat = new THREE.MeshBasicMaterial({ color: renderHex(c), transparent: true, opacity: o, depthWrite: false });
        const g = new THREE.InstancedMesh(this.box, mat, MAX_GHOSTS);
        g.count = 0; g.frustumCulled = false;
        this.root.add(g); this.disposables.push(g, mat);
        return g;
      }));
    }
    const npi = m.nameplate ? m.nameplate.piece : P.findIndex(p => p.nameplate);
    if (npi >= 0 && m.nameplate) this.addNameplate(npi, m.nameplate.lines);
    // pieces fading in are drawn with a material of their own: ready before the first one comes
    if (this.tl.fade) { const f = this.fadeMesh(0); f.visible = true; this.renderer.compile(this.scene, this.camera); }

    // mount: the wall turns model y towards the viewer and model z up
    this.mount.rotation.set(wall ? Math.PI / 2 : 0, 0, 0);
    this.mount.position.set(0, 0, 0);
    this.mount.updateMatrixWorld(true);
    const pts = this.corners(P);
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3());
    // centre on x, and sit on the floor (table) or against the wall (wall)
    const shift = wall ? new THREE.Vector3(-c.x, -c.y, -box.min.z) : new THREE.Vector3(-c.x, -box.min.y, -c.z);
    this.mount.position.copy(shift); this.mount.updateMatrixWorld(true);
    pts.forEach(p => p.add(shift)); box.translate(shift);
    this.pts = pts;
    this.bounds.copy(box);
    const size = box.getSize(new THREE.Vector3()), r = size.length() / 2, ctr = box.getCenter(new THREE.Vector3());
    // wall: a shadow-only plane, kept inside the shadow frustum (no frustum edge on screen)
    this.ground.scale.setScalar(r * 4);
    this.ground.rotation.set(wall ? 0 : -Math.PI / 2, 0, 0);
    this.ground.position.set(ctr.x, wall ? ctr.y : 0, wall ? 0 : ctr.z);
    const lights: [THREE.DirectionalLight, THREE.Vector3, number][] = wall
      ? [[this.key, new THREE.Vector3(-0.55, 0.75, 1), 0.9], [this.soft, new THREE.Vector3(0.6, 0.2, 1), 0]]
      : [[this.key, new THREE.Vector3(-0.6, 1.25, 0.55), 0.8], [this.soft, new THREE.Vector3(0.7, 0.6, 0.8), 0]];
    for (const [l, dir, blur] of lights) {
      l.position.copy(ctr).addScaledVector(dir.normalize(), r * 5);
      l.target.position.copy(ctr);
      if (!l.castShadow) continue;
      // ~10 texels of blur whatever the model size (fewer would alias, more would need more samples)
      const sc = l.shadow.camera, half = r * 2.6, cap = this.opts.lowPower ? 2048 : 4096;
      const size = Math.min(cap, Math.max(512, 2 ** Math.ceil(Math.log2((20 * half) / blur))));
      Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: r * 2, far: r * 8 });
      sc.updateProjectionMatrix();
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose(); l.shadow.map = null; l.shadow.mapPass?.dispose(); l.shadow.mapPass = null;
      }
      l.shadow.radius = blur / ((2 * half) / size);
    }
    this.ground.visible = wall;
    this.blob.visible = !wall;
    if (!wall) this.dropShadow(P, shift);
    if (m.display === 'backdrop') this.wallShadow(P);
    this.pose(Infinity);
    this.homeView = { ...defaultView(m), ...view };
    this.limits();
    this.frame(this.homeView);
    this.controls?.update();
  }

  /** live: stay in front of the wall, or above the floor, between a close look and twice the default distance */
  private limits() {
    const ctl = this.controls, m = this.model;
    if (!ctl || !m) return;
    const wall = m.pose === 'wall', fit = this.fit(this.homeView);
    ctl.minDistance = Math.max(4, fit.dist * 0.12); ctl.maxDistance = fit.dist * 2.2;
    ctl.minPolarAngle = wall ? 0.5 : 0.05; ctl.maxPolarAngle = wall ? Math.PI - 0.5 : 1.45;
    ctl.minAzimuthAngle = wall ? -1.1 : -Infinity; ctl.maxAzimuthAngle = wall ? 1.1 : Infinity;
  }

  /** table: a soft blurred footprint under the model, a little away from the key light */
  private dropShadow(pieces: Piece[], shift: THREE.Vector3) {
    const px = 8, pad = 14;
    const x0 = Math.min(...pieces.map(p => p.x)) - pad, x1 = Math.max(...pieces.map(p => p.x + p.w)) + pad;
    const z0 = Math.min(...pieces.map(p => p.z)) - pad, z1 = Math.max(...pieces.map(p => p.z + p.d)) + pad;
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    a.width = b.width = Math.min(4096, (x1 - x0) * px); a.height = b.height = Math.min(4096, (z1 - z0) * px);
    const k = a.width / (x1 - x0), ax = a.getContext('2d')!, bx = b.getContext('2d')!;
    ax.fillStyle = '#1c232b';
    for (const p of pieces) ax.fillRect((p.x - x0) * k, (z1 - p.z - p.d) * k, p.w * k, p.d * k);
    // a tight contact shadow and a wide soft one
    for (const [blur, alpha] of [[0.5, 0.45], [3.5, 0.4]]) { bx.filter = `blur(${Math.round(blur * k)}px)`; bx.globalAlpha = alpha; bx.drawImage(a, 0, 0); }
    const mat = this.blob.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = new THREE.CanvasTexture(b); mat.map.colorSpace = THREE.SRGBColorSpace; mat.needsUpdate = true;
    this.blob.scale.set(x1 - x0, z1 - z0, 1);
    this.blob.position.set((x0 + x1) / 2 + shift.x + 0.5, 0.002, -(z0 + z1) / 2 + shift.z - 0.5);
  }

  /** Backdrop: the ribbon's shadow on the wall's face, as from a light at the front left, a little above */
  private wallShadow(pieces: Piece[]) {
    const wall = pieces.filter(p => p.c === WHITE && p.kind === 'brick' && p.role === 'display'), rib = pieces.filter(p => p.role === 'squiggle');
    if (!wall.length || !rib.length) return;
    const wz = Math.min(...wall.map(p => p.z)), px = 12;
    const x0 = Math.min(...wall.map(p => p.x)), x1 = Math.max(...wall.map(p => p.x + p.w));
    const y0 = Math.min(...wall.map(p => p.y)) * PL, y1 = Math.max(...wall.map(p => p.y + p.h)) * PL;
    const a = document.createElement('canvas'), b = document.createElement('canvas');
    a.width = b.width = Math.round((x1 - x0) * px); a.height = b.height = Math.round((y1 - y0) * px);
    const ax = a.getContext('2d')!, bx = b.getContext('2d')!;
    // each piece swept along the light, from its front to its back: the shadow moves right and down with the distance;
    // the far part lighter, under the near part
    bx.fillStyle = ax.fillStyle = '#1c232b';
    for (const far of [true, false]) {
      const cx = far ? bx : ax;
      for (const p of rib) for (let z = p.z; z <= p.z + p.d; z += 0.5) {
        const d = wz - z, sx = d * WALL_LIGHT.x, sy = d * WALL_LIGHT.y;
        if (d > WALL_LIGHT.far === far) cx.fillRect((p.x + sx - x0) * px, (y1 - (p.y + p.h) * PL - sy) * px, p.w * px, p.h * PL * px);
      }
    }
    ax.globalCompositeOperation = 'destination-over'; ax.globalAlpha = WALL_LIGHT.farAlpha; ax.drawImage(b, 0, 0);
    bx.clearRect(0, 0, b.width, b.height);
    for (const [blur, alpha] of WALL_LIGHT.blur) { bx.filter = `blur(${Math.round(blur * px)}px)`; bx.globalAlpha = alpha; bx.drawImage(a, 0, 0); }
    const tex = new THREE.CanvasTexture(b); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, -wz - 0.005);   // just in front of the bricks' faces (at −wz − 0.015)
    this.root.add(mesh);
    this.disposables.push(geo, mat, tex);
    this.decal = mat;
  }

  /** world-space corners of every piece, for a tight framing */
  private corners(pieces: Piece[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [], mw = this.root.matrixWorld;
    for (const p of pieces) for (const x of [p.x, p.x + p.w]) for (const y of [p.y, p.y + p.h]) for (const z of [p.z, p.z + p.d])
      out.push(new THREE.Vector3(x, y * PL, -z).applyMatrix4(mw));
    return out;
  }

  /** World box of some pieces (all by default), in place. */
  pieceBox(ids?: number[]): THREE.Box3 {
    const P = this.model?.pieces ?? [];
    return new THREE.Box3().setFromPoints(this.corners(ids ? ids.map(i => P[i]) : P));
  }

  /** Where the camera goes to see the model (or `pts`) from a direction, fitted in view. */
  fit(v: View, pts = this.pts): Shot {
    const tv = Math.tan((v.fov * Math.PI) / 360), th = tv * this.camera.aspect, dir = dirOf(v.az, v.el);
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right);
    const box = new THREE.Box3().setFromPoints(pts), target = box.getCenter(new THREE.Vector3());
    let dist = box.getSize(new THREE.Vector3()).length() / tv;
    const o = new THREE.Vector3();
    for (let it = 0; it < 8; it++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        o.subVectors(p, target);
        const depth = dist - o.dot(dir), x = o.dot(right) / (depth * th), y = o.dot(up) / (depth * tv);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      target.addScaledVector(right, ((x0 + x1) / 2) * th * dist).addScaledVector(up, ((y0 + y1) / 2) * tv * dist);
      dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / (1 - v.margin);
    }
    return { target, dir, dist, fov: v.fov };
  }

  /** The model's points (or `pts`) seen from a shot, in the fit's measure: x right, y up, −1..1 across the view. */
  private project(s: Shot, pts = this.pts): [Float32Array, Float32Array] {
    const tv = Math.tan((s.fov * Math.PI) / 360), th = tv * this.camera.aspect;
    const right = new THREE.Vector3(0, 1, 0).cross(s.dir).normalize(), up = s.dir.clone().cross(right), o = new THREE.Vector3();
    const xs = new Float32Array(pts.length), ys = new Float32Array(pts.length);
    pts.forEach((p, i) => {
      o.subVectors(p, s.target);
      const depth = s.dist - o.dot(s.dir);
      xs[i] = o.dot(right) / (depth * th); ys[i] = o.dot(up) / (depth * tv);
    });
    return [xs, ys];
  }

  /** How far the model (or `pts`) seen from a shot reaches into a rectangle of the view [x0, y0, x1, y1] (the fit's
   *  measure, y up): ≤ 0 when clear of it. */
  reach(s: Shot, rect: [number, number, number, number], pts = this.pts): number {
    return into(...this.project(s, pts), rect);
  }

  /** A shot widened just enough that the model (or `pts`) keeps out of the view's top right corner from `corner`
   *  (the fit's measure: a title over the picture). It zooms out about the bottom of the view's `margin` (the model
   *  shrinks towards it, the space it leaves at the top goes to the corner), by the least factor (bisection: more
   *  only helps): one measure, which changes smoothly along a camera move. */
  avoidCorner(s: Shot, corner: [number, number], margin: number, pts = this.pts): Shot {
    const [cx, cy] = corner, pad = 0.004, lo = -(1 - margin);
    let out = s;
    for (let it = 0; it < 8; it++) {
      const [xs, ys] = this.project(out, pts);
      if (into(xs, ys, [cx, cy, Infinity, Infinity]) <= 0) break;
      // zoomed out k× about (0, lo), the points right of the corner's edge (x > cx·k) must come under it
      const clear = (k: number) => {
        for (let i = 0; i < xs.length; i++) if (xs[i] > cx * k && lo + (ys[i] - lo) / k > cy - pad) return false;
        return true;
      };
      let a = 1, b = 1.6;
      if (!clear(b)) break;
      for (let j = 0; j < 24; j++) { const c = (a + b) / 2; if (clear(c)) b = c; else a = c; }
      const tv = Math.tan((out.fov * Math.PI) / 360), dist = out.dist * b, dy = lo * (1 - 1 / b);
      const right = new THREE.Vector3(0, 1, 0).cross(out.dir).normalize(), up = out.dir.clone().cross(right);
      out = { ...out, dist, target: out.target.clone().addScaledVector(up, -dy * tv * dist) };
    }
    return out;
  }

  /** Put the camera at a shot. */
  look(s: Shot) {
    const cam = this.camera;
    cam.fov = s.fov;
    cam.position.copy(s.target).addScaledVector(s.dir, s.dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(s.target);
    cam.near = s.dist / 20; cam.far = s.dist * 20; cam.updateProjectionMatrix();
    this.placed.copy(cam.position);
    this.controls?.target.copy(s.target);
    this.request();
  }

  /** Aim the camera from a direction and fit the model in view. */
  frame(v: View) {
    this.view = v;
    this.look(this.fit(v));
  }

  /** The current camera as a shot. */
  shot(): Shot {
    const target = this.controls?.target.clone() ?? this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(100).add(this.camera.position);
    const o = this.camera.position.clone().sub(target), dist = o.length();
    return { target, dir: o.divideScalar(dist || 1), dist, fov: this.camera.fov };
  }

  get defaultView(): View { return this.homeView; }

  private addNameplate(i: number, lines: [string, string]) {
    const p = this.model!.pieces[i];
    const tex = new THREE.CanvasTexture(nameplateCanvas(lines));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const long = Math.max(p.w, p.d), short = Math.min(p.w, p.d);
    const geo = new THREE.PlaneGeometry(long - 0.1, short - 0.1), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, transparent: !!this.tl?.fade });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.set(-Math.PI / 2, 0, p.d > p.w ? Math.PI / 2 : 0);
    const y = (p.y + p.h) * PL + 0.004;
    mesh.position.set(p.x + p.w / 2, y, -(p.z + p.d / 2));
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.disposables.push(geo, mat, tex);
    this.np = { mesh, i, y };
  }

  /** the n-th of the meshes drawing the pieces fading in (see-through, one piece each) */
  private fadeMesh(n: number) {
    let f = this.fades[n];
    if (!f) {
      f = new THREE.Mesh(this.box, new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0, transparent: true, depthWrite: false }));
      f.frustumCulled = false; f.receiveShadow = true;
      this.root.add(f); this.fades.push(f);
    }
    return f;
  }

  // ---- build animation ----

  /** Every piece where it is at time t of the build (Infinity: finished). */
  pose(t: number) {
    const m = this.model, tl = this.tl;
    if (!m || !tl) return;
    this.t = t;
    const P = m.pieces, H = this.home, m4 = this.m4, st = this.state, off = this.off;
    const used = new Map<THREE.InstancedMesh, number>();
    for (const gs of this.ghostSets.values()) for (const g of gs) used.set(g, 0);
    let rib = 0, ribN = 0, base = 0, nf = 0, npAlpha = 1;
    const first = new Set(m.steps[0] ?? []), fading = new Set<number>();
    for (let i = 0; i < P.length; i++) {
      const s = pieceState(tl, i, t), p = P[i], [mesh, j] = this.slots[i], k = this.casterOf[i];
      st[i] = s.visible ? (s.landed ? 2 : 1) : 0; off[i] = s.off;
      if (p.role === 'squiggle') { ribN++; if (s.landed) rib++; }
      if (s.landed && first.has(i)) base++;
      if (!s.visible) { mesh.setMatrixAt(j, ZERO); if (k >= 0) this.caster!.setMatrixAt(k, ZERO); continue; }
      const x = H[3 * i], y = H[3 * i + 1] + s.off, z = H[3 * i + 2];
      if (s.alpha !== undefined) {
        // fading in: out of its instanced mesh, drawn on its own (its studs show once it is solid)
        mesh.setMatrixAt(j, ZERO);
        fading.add(i);
        if (this.np?.i === i) npAlpha = s.alpha;
        const f = this.fadeMesh(nf);
        f.geometry = mesh.geometry; f.material.color.set(renderHex(p.c)); f.material.opacity = s.alpha;
        f.position.set(x, y, z); f.visible = true;
        nf++;
      } else mesh.setMatrixAt(j, m4.makeTranslation(x, y, z));
      if (k >= 0) this.caster!.setMatrixAt(k, m4.makeScale(p.w - 0.03, p.h * PL - 0.02, p.d - 0.03).setPosition(x, y + (p.h * PL) / 2, z));
      if (s.speed > 0) this.ghostSets.get(p.c)?.forEach((g, n) => {
        const u = used.get(g)!;
        if (u >= MAX_GHOSTS) return;
        g.setMatrixAt(u, m4.makeScale(p.w - 0.03, p.h * PL, p.d - 0.03).setPosition(x, y + (p.h * PL) / 2 + s.speed * (n + 1) * 0.018, z));
        used.set(g, u + 1);
      });
    }
    for (const ss of this.studSets) {
      const { mesh, owner, cover, at } = ss;
      for (let k = 0; k < owner.length; k++) {
        const o = owner[k], c = cover[k];
        if (!st[o] || (c >= 0 && st[c] === 2) || fading.has(o)) mesh.setMatrixAt(k, ZERO);
        else mesh.setMatrixAt(k, m4.makeTranslation(at[3 * k], at[3 * k + 1] + off[o], at[3 * k + 2]));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    if (this.caster) this.caster.instanceMatrix.needsUpdate = true;
    for (const [g, n] of used) { g.count = n; g.instanceMatrix.needsUpdate = true; }
    for (let k = nf; k < this.fades.length; k++) this.fades[k].visible = false;
    if (this.np) {
      const { mesh, i, y } = this.np;
      mesh.visible = st[i] > 0; mesh.position.y = y + off[i]; mesh.material.opacity = npAlpha;
    }
    if (this.decal) this.decal.opacity = ribN ? ease(rib / ribN) : 1;
    (this.blob.material as THREE.MeshBasicMaterial).opacity = first.size ? ease(base / first.size) : 1;
    this.renderer.shadowMap.needsUpdate = true;
    this.request();
  }

  /** The page's camera during the build: off to the side, above and further, settling on the default view (a hung
   *  model: from well aside, faced only at the end). */
  buildView(t: number): View {
    const v = this.homeView, wall = this.model?.pose === 'wall', u = buildTurn(t, this.tl?.built ?? 1, wall);
    const [az, el, margin] = BUILD_VIEW[wall ? 'wall' : this.model?.format === 'mosaic' ? 'mosaic' : 'table'];
    return { ...v, az: v.az + (1 - u) * az, el: v.el + (1 - u) * el, margin: v.margin + (1 - u) * margin };
  }

  /** Live: run the build animation from the start. */
  play() {
    if (!this.model || !this.tl) return;
    this.playing = true; this.userMoved = false; this.tween = null; this.sway.on = false;
    this.t0 = performance.now();
    this.pose(0);
    this.frame(this.buildView(0));
  }

  replay() { this.play(); }

  /** Live: jump to the finished model. */
  skip() {
    if (!this.model) return;
    this.finish();
  }

  private finish() {
    this.playing = false;
    this.pose(Infinity);
    if (!this.userMoved) { this.frame(this.homeView); this.startSway(); }
    this.onFinished?.();
  }

  private startSway() {
    this.sway = { on: !!this.controls && !!this.opts.autoRotate && this.model?.pose === 'table', t: 0, last: performance.now() };
    this.request();
  }

  /** Live: back to the default view (smoothly). */
  resetView(animate = true) {
    if (!this.model) return;
    this.userMoved = false;
    const to = this.fit(this.homeView);
    if (!animate || !this.controls) { this.tween = null; this.frame(this.homeView); return; }
    this.tween = { t0: performance.now(), ms: 700, from: this.shot(), to };
    this.request();
  }

  get isPlaying() { return this.playing; }
  /** seconds into the build animation */
  get time() { return this.playing ? (performance.now() - this.t0) / 1000 : Math.min(this.t, this.tl?.built ?? 0); }

  /** keep the orbit target on the model, the camera clear of the floor */
  private constrain() {
    const ctl = this.controls;
    if (!ctl || !this.model) return;
    const before = ctl.target.clone();
    ctl.target.clamp(this.bounds.min, this.bounds.max);
    this.camera.position.add(before.sub(ctl.target).negate());
    if (this.model.pose === 'table' && this.camera.position.y < 0.5) this.camera.position.y = 0.5;
    const d = this.camera.position.distanceTo(ctl.target);
    this.camera.near = d / 25; this.camera.far = d * 25; this.camera.updateProjectionMatrix();
  }

  private request() {
    if (this.live && !this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.raf = 0;
    if (!this.model) return;
    let more = false;
    if (this.playing) {
      const t = (performance.now() - this.t0) / 1000;
      if (t >= this.tl!.built) this.finish();
      else {
        this.pose(t);
        if (!this.userMoved) this.frame(this.buildView(t));
        more = true;
      }
    }
    if (this.tween) {
      const { t0, ms, from, to } = this.tween, u = easeIO((performance.now() - t0) / ms);
      const a = new THREE.Spherical().setFromVector3(from.dir), b = new THREE.Spherical().setFromVector3(to.dir);
      let dt = b.theta - a.theta;
      dt -= Math.round(dt / (2 * Math.PI)) * 2 * Math.PI;
      const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, a.phi + (b.phi - a.phi) * u, a.theta + dt * u));
      this.look({ target: from.target.clone().lerp(to.target, u), dir, dist: from.dist * Math.pow(to.dist / from.dist, u), fov: to.fov });
      if (u >= 1) { this.tween = null; this.frame(this.homeView); this.startSway(); } else more = true;
    } else if (this.sway.on && !this.playing && this.onScreen) {
      // ±18° either side of the default view, a swing every 16 s (paused off screen)
      const now = performance.now(), v = this.homeView;
      this.sway.t += Math.min(0.1, (now - this.sway.last) / 1000); this.sway.last = now;
      this.frame({ ...v, az: v.az + 18 * Math.sin((2 * Math.PI * this.sway.t) / 16) });
      more = true;
    }
    if (this.controls?.update()) more = true;
    if (this.onScreen) this.renderer.render(this.scene, this.camera);
    if (more) this.request();
  };

  render() { this.renderer.render(this.scene, this.camera); }

  toDataURL(type = 'image/jpeg', quality = 0.9): string {
    this.render();
    const src = this.renderer.domElement;
    if (this.ss === 1) return src.toDataURL(type, quality);
    const size = this.renderer.getSize(new THREE.Vector2()), c = document.createElement('canvas');
    c.width = size.x; c.height = size.y;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.observers.forEach(o => o.disconnect());
    this.controls?.dispose();
    this.clear();
    this.mats.forEach(m => m.dispose()); this.holeMat.dispose(); this.wallMat.dispose(); this.box.dispose(); this.casterMat.dispose();
    (this.blob.material as THREE.MeshBasicMaterial).map?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    if (this.ownCanvas) this.renderer.forceContextLoss();   // browsers keep only a few WebGL contexts
  }
}
