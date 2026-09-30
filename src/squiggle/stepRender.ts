// Off-screen 3D views for the Squiggle booklet: the steps it does not draw flat,
// and the close-ups beside those it does (a Frame corner, a brace behind the wall,
// a ribbon layer). A build step shows the pieces placed before it muted, its own
// in colour with an outline, later ones hidden, from one camera per model: the
// Frame lies flat on the table, seen from above the front (turned over for the
// pieces under its back), Floating and Backdrop from a three-quarter plunge (from
// behind for what hides behind the wall), the Mosaic from above the front. A raised
// ribbon (Floating, Backdrop) is built on the table beside the base, then lowered
// onto its clear supports. Plus the back of the hung Frame for the Hanging page.
// Only the studs nothing rests on are drawn. Every StepRender shares one WebGL
// context, freed with the last one.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { COLOR_BY_ID, renderHex, TRANS_CLEAR } from '../core/palette';
import type { Piece } from '../core/parts';
import { geoKey, pieceGeometry, studGeometry } from '../viewer/geometry';
import { PL } from '../viewer/timeline';
import { ghost, GOLD, NAVY_ON, tint } from './booklet';
import type { SqModel } from './model';
import { nameplateCanvas } from './nameplate';
import { WHITE } from './spectrum';

export type Pt = [number, number];
/** a model point: x, y (plates), z */
export type P3 = [number, number, number];
/** A render and where a model point (studs, plates, studs) lands on it, in its pixels. */
export interface Shot { canvas: HTMLCanvasElement; project(x: number, y: number, z: number): Pt }
type State = 0 | 1 | 2;                 // hidden, pale (placed before), full (this step)
interface View { dir: THREE.Vector3; up: THREE.Vector3; fov: number; flip: boolean; floor: boolean; margin: number; fit?: P3[] | null }
/** where a step is seen from: the front, from behind (the Backdrop's wall), or turned over (the Frame's back) */
export type Side = 'front' | 'back' | 'under';

const NAVY = '#1d3b5c';
const hasStuds = (p: Piece) => p.kind !== 'tile' && p.kind !== 'slope';
const dirOf = (az: number, el: number) => {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
};

/** camera azimuth and elevation (degrees) of a model's step views */
export function stepAngles(m: SqModel): { az: number; el: number } {
  if (m.format === 'mosaic') return { az: -8, el: 56 };
  if (m.display === 'frame') return { az: -10, el: 52 };
  return { az: -26, el: 36 };
}

/** the WebGL context every StepRender draws with (browsers drop the oldest past ~16: the page's live view, if each
 *  page maker kept its own) */
interface Shared { gl: THREE.WebGLRenderer; users: number; timer: ReturnType<typeof setTimeout> | null }
let shared: Shared | null = null;
function acquire() {
  if (!shared || shared.gl.getContext().isContextLost()) {
    const gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
    gl.setClearColor(0xffffff, 0);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFShadowMap;
    shared = { gl, users: 0, timer: null };
  }
  if (shared.timer) { clearTimeout(shared.timer); shared.timer = null; }
  shared.users++;
  return shared;
}
/** one user less: with none left for 3 s (the reader switching models takes it back), the context is freed, once */
function release(s: Shared) {
  if (--s.users > 0) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    if (s.users > 0) return;
    if (shared === s) shared = null;
    const lost = s.gl.getContext().isContextLost();
    s.gl.dispose();
    if (!lost) s.gl.forceContextLoss();
    s.gl.domElement.width = s.gl.domElement.height = 0;
  }, 3000);
}

export class StepRender {
  private ctx = acquire();
  private gl = this.ctx.gl;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 5000);
  private pose = new THREE.Group();
  private root = new THREE.Group();
  private sets: { full: THREE.InstancedMesh; pale: THREE.InstancedMesh; ids: number[] }[] = [];
  private studs = new Map<string, THREE.InstancedMesh>();
  private mats = new Map<string, THREE.Material>();
  private lines: LineSegments2[] = [];
  private stepOf: number[] = [];
  private pts: THREE.Vector3[] = [];
  private key = new THREE.DirectionalLight(0xffffff, 2.3);
  private fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  private floor: THREE.Mesh;
  private plate: THREE.Mesh | null = null;
  private plateIdx: number;
  private wallZ: number;
  private hole = new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.9 });
  private disposables: { dispose(): void }[] = [];
  /** a raised ribbon's bottom (plates): it is built on the table, this much lower; 0 when built in place */
  readonly lift: number;
  private ribbon: number[];
  private disposed = false;

  constructor(private m: SqModel, private ss = 1.5) {
    const pm = new THREE.PMREMGenerator(this.gl);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pm.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6470, 1.1));
    this.key.castShadow = true; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02; this.key.shadow.radius = 3;
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x1c2b3a, opacity: 0.2 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.pose);
    this.pose.add(this.root);

    const P = m.pieces, groups = new Map<string, number[]>();
    P.forEach((p, i) => { const k = geoKey(p) + '|' + p.c; groups.set(k, [...(groups.get(k) ?? []), i]); });
    for (const ids of groups.values()) {
      const p0 = P[ids[0]], geo = pieceGeometry(p0, false, false);
      const mk = (pale: boolean) => {
        const mat = this.mat(p0.c, pale), mesh = new THREE.InstancedMesh(geo, geo.groups.length > 1 ? [mat, this.hole] : mat, ids.length);
        mesh.castShadow = !COLOR_BY_ID.get(p0.c)!.trans; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
        this.root.add(mesh); this.disposables.push(mesh);
        return mesh;
      };
      this.sets.push({ full: mk(false), pale: mk(true), ids });
    }
    // stud meshes by colour and state, sized for every stud of that colour
    const cap = new Map<number, number>();
    for (const p of P) if (hasStuds(p)) cap.set(p.c, (cap.get(p.c) ?? 0) + p.w * p.d);
    for (const [c, n] of cap) for (const pale of [false, true]) {
      const mesh = new THREE.InstancedMesh(studGeometry(), this.mat(c, pale), n);
      mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      this.studs.set(`${c}|${+pale}`, mesh); this.root.add(mesh); this.disposables.push(mesh);
    }
    for (const col of [GOLD, NAVY]) {
      const line = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color: new THREE.Color(col), linewidth: 2.2 }));
      line.frustumCulled = false; line.renderOrder = 2;
      this.lines.push(line); this.root.add(line); this.disposables.push(line.material);
    }
    m.steps.forEach((s, si) => s.forEach(i => { this.stepOf[i] = si; }));
    for (const p of P) for (const x of [p.x, p.x + p.w]) for (const y of [p.y, p.y + p.h]) for (const z of [p.z, p.z + p.d]) this.pts.push(new THREE.Vector3(x, y * PL, -z));
    this.plateIdx = m.nameplate?.piece ?? P.findIndex(p => p.nameplate);
    if (this.plateIdx >= 0 && m.nameplate) {
      const p = P[this.plateIdx], tex = new THREE.CanvasTexture(nameplateCanvas(m.nameplate.lines, 1024));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const geo = new THREE.PlaneGeometry(Math.max(p.w, p.d) - 0.1, Math.min(p.w, p.d) - 0.1), mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
      this.plate = new THREE.Mesh(geo, mat);
      this.plate.rotation.set(-Math.PI / 2, 0, p.d > p.w ? Math.PI / 2 : 0);
      this.plate.position.set(p.x + p.w / 2, (p.y + p.h) * PL + 0.004, -(p.z + p.d / 2));
      this.root.add(this.plate); this.disposables.push(geo, mat, tex);
    }
    const wall = P.filter(p => p.role === 'display' && p.kind === 'brick' && p.c === WHITE);
    this.wallZ = wall.length ? Math.min(...wall.map(p => p.z)) : Infinity;
    this.ribbon = P.flatMap((p, i) => (p.role === 'squiggle' ? [i] : []));
    this.lift = P.some(p => p.support) && this.ribbon.length ? Math.min(...this.ribbon.map(i => P[i].y)) : 0;
  }

  /** is step `si` part of the raised ribbon, built on the table? */
  sub(si: number): boolean { return this.lift > 0 && this.m.steps[si].every(i => this.m.pieces[i].role === 'squiggle'); }

  private mat(c: number, pale: boolean): THREE.Material {
    const k = `${c}|${+pale}`;
    let m = this.mats.get(k);
    if (!m) {
      const hex = renderHex(c);
      m = c === TRANS_CLEAR || COLOR_BY_ID.get(c)!.trans
        ? new THREE.MeshStandardMaterial({ color: '#dcebf5', roughness: 0.1, transparent: true, opacity: pale ? 0.35 : 0.55, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(pale ? ghost(hex) : hex), roughness: pale ? 0.75 : 0.35 });
      this.mats.set(k, m); this.disposables.push(m);
    }
    return m;
  }

  /** muted pieces: duller colours (build steps), or light (a backdrop for black parts to stand out on) */
  private tone(light: boolean) {
    for (const [k, m] of this.mats) {
      const [c, pale] = k.split('|').map(Number), hex = renderHex(c);
      if (pale && !COLOR_BY_ID.get(c)!.trans) (m as THREE.MeshStandardMaterial).color.set(light ? tint(hex, 0.55) : ghost(hex));
    }
  }

  /** Show every piece in a state, moved up `dy(i)` plates, and outline the full ones when `outline`. */
  private show(state: (i: number) => State, outline: (i: number) => boolean, dy: (i: number) => number = () => 0) {
    const P = this.m.pieces, m4 = new THREE.Matrix4(), Y = (i: number) => P[i].y + dy(i);
    for (const s of this.sets) {
      let f = 0, p = 0;
      for (const i of s.ids) {
        const st = state(i), q = P[i];
        if (!st) continue;
        m4.makeTranslation(q.x + q.w / 2, Y(i) * PL, -(q.z + q.d / 2));
        if (st === 2) s.full.setMatrixAt(f++, m4); else s.pale.setMatrixAt(p++, m4);
      }
      s.full.count = f; s.pale.count = p;
      s.full.instanceMatrix.needsUpdate = s.pale.instanceMatrix.needsUpdate = true;
    }
    // open studs of the shown pieces
    const bottoms = new Set<string>(), n = new Map<string, number>();
    P.forEach((q, i) => { if (state(i)) for (let a = 0; a < q.w; a++) for (let b = 0; b < q.d; b++) bottoms.add(`${q.x + a},${q.z + b},${Y(i)}`); });
    P.forEach((q, i) => {
      const st = state(i);
      if (!st || !hasStuds(q)) return;
      const mesh = this.studs.get(`${q.c}|${+(st === 1)}`)!;
      let k = n.get(mesh.uuid) ?? 0;
      for (let a = 0; a < q.w; a++) for (let b = 0; b < q.d; b++) {
        if (bottoms.has(`${q.x + a},${q.z + b},${Y(i) + q.h}`)) continue;
        mesh.setMatrixAt(k++, m4.makeTranslation(q.x + a + 0.5, (Y(i) + q.h) * PL, -(q.z + b + 0.5)));
      }
      n.set(mesh.uuid, k);
    });
    for (const mesh of this.studs.values()) { mesh.count = n.get(mesh.uuid) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    if (this.plate) this.plate.visible = state(this.plateIdx) !== 0;
    // outlines: box edges (round pieces: top and bottom rims)
    const seg: [number[], number[]] = [[], []];
    P.forEach((q, i) => {
      if (state(i) !== 2 || !outline(i)) return;
      const out = seg[NAVY_ON.has(q.c) ? 1 : 0], e = 0.012;
      const x0 = q.x + e, x1 = q.x + q.w - e, y0 = Y(i) * PL + e, y1 = (Y(i) + q.h) * PL - e, z0 = -(q.z + e), z1 = -(q.z + q.d - e);
      if (q.kind === 'round') {
        const cx = q.x + 0.5, cz = -(q.z + 0.5), r = 0.49;
        for (const y of [y0, y1]) for (let k = 0; k < 20; k++) {
          const a = (k / 20) * Math.PI * 2, b = ((k + 1) / 20) * Math.PI * 2;
          out.push(cx + r * Math.cos(a), y, cz + r * Math.sin(a), cx + r * Math.cos(b), y, cz + r * Math.sin(b));
        }
        return;
      }
      for (const y of [y0, y1]) out.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
      for (const x of [x0, x1]) for (const z of [z0, z1]) out.push(x, y0, z, x, y1, z);
    });
    this.lines.forEach((l, k) => {
      l.visible = seg[k].length > 0;
      if (l.visible) { l.geometry.dispose(); l.geometry = new LineSegmentsGeometry().setPositions(seg[k]); }
    });
  }

  /** the view of a step: flipped when all its pieces go under what is already built, from behind the Backdrop's wall;
   *  a raised ribbon's steps framed on the ribbon alone, on the table */
  private viewOf(si: number): View {
    const P = this.m.pieces, ids = this.m.steps[si], { az, el } = stepAngles(this.m), up = new THREE.Vector3(0, 1, 0);
    if (this.sub(si)) return { dir: dirOf(az, el), up, fov: 24, flip: false, floor: true, margin: 0.04, fit: this.corners(this.ribbon, -this.lift) };
    const before = P.filter((_, i) => this.stepOf[i] < si);
    const flip = before.length > 0 && Math.max(...ids.map(i => P[i].y + P[i].h)) <= Math.min(...before.map(p => p.y));
    const rear = ids.some(i => P[i].z > this.wallZ);
    return { dir: rear ? dirOf(180 + 24, 32) : dirOf(az, el), up, fov: 24, flip, floor: true, margin: 0.04 };
  }

  /** where step `si` is seen from */
  side(si: number): Side { const v = this.viewOf(si); return v.flip ? 'under' : v.dir.z < 0 ? 'back' : 'front'; }

  /** what step `si` shows: before it muted, it in full, later hidden; a raised ribbon alone and on the table */
  private stepState(si: number): [(i: number) => State, (i: number) => number] {
    const sub = this.sub(si), P = this.m.pieces;
    return [i => (sub && P[i].role !== 'squiggle' ? 0 : this.stepOf[i] < si ? 1 : this.stepOf[i] === si ? 2 : 0), () => (sub ? -this.lift : 0)];
  }

  /** width / height of the whole model (a raised ribbon's steps: the ribbon) as a step of `si` shows it (for the page layout) */
  aspect(si: number): number {
    const v = this.viewOf(si), all = this.posed(v.flip), mw = this.root.matrixWorld;
    const pts = v.fit ? v.fit.map(([x, y, z]) => new THREE.Vector3(x, y * PL, -z).applyMatrix4(mw)) : all;
    const right = v.up.clone().cross(v.dir).normalize(), up = v.dir.clone().cross(right);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const x = p.dot(right), y = p.dot(up); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return (x1 - x0) / (y1 - y0);
  }

  /** the model's corners after the pose (turned over or not), centred on x and z, on the floor */
  private posed(flip: boolean): THREE.Vector3[] {
    this.pose.rotation.set(0, 0, flip ? Math.PI : 0);
    this.pose.position.set(0, 0, 0);
    this.pose.updateMatrixWorld(true);
    const mw = this.root.matrixWorld, pts = this.pts.map(p => p.clone().applyMatrix4(mw)), box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3()), shift = new THREE.Vector3(-c.x, -box.min.y, -c.z);
    this.pose.position.copy(shift); this.pose.updateMatrixWorld(true);
    return pts.map(p => p.add(shift));
  }

  /** Render the shown pieces from `v`, framed on the whole model (and `extra` points), or on `fit` only. */
  private shoot(w: number, h: number, v: View, fit: P3[] | null = null, extra: P3[] = []): Shot {
    const all = this.posed(v.flip), cam = this.camera, mw0 = this.root.matrixWorld;
    const world = (q: P3[]) => q.map(([px, py, pz]) => new THREE.Vector3(px, py * PL, -pz).applyMatrix4(mw0));
    const pts = fit ? world(fit) : [...all, ...world(extra)];
    this.gl.setPixelRatio(this.ss); this.gl.setSize(w, h, false);
    cam.aspect = w / h; cam.fov = v.fov; cam.up.copy(v.up);
    // fit: aim at the middle of the projected box, then pull back until it fills the view less the margin
    const right = v.up.clone().cross(v.dir).normalize(), up = v.dir.clone().cross(right);
    const tv = Math.tan((v.fov * Math.PI) / 360), th = tv * cam.aspect, box = new THREE.Box3().setFromPoints(pts);
    const target = box.getCenter(new THREE.Vector3()), o = new THREE.Vector3();
    let dist = box.getSize(new THREE.Vector3()).length() / tv;
    for (let it = 0; it < 8; it++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        o.subVectors(p, target);
        const depth = dist - o.dot(v.dir), x = o.dot(right) / (depth * th), y = o.dot(up) / (depth * tv);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      target.addScaledVector(right, ((x0 + x1) / 2) * th * dist).addScaledVector(up, ((y0 + y1) / 2) * tv * dist);
      dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / (1 - v.margin);
    }
    cam.position.copy(target).addScaledVector(v.dir, dist);
    cam.lookAt(target);
    cam.near = dist / 20; cam.far = dist * 20; cam.updateProjectionMatrix();
    // lights follow the camera: key from its upper left, fill from its right
    const r = new THREE.Box3().setFromPoints(all).getSize(new THREE.Vector3()).length() / 2;
    const mid = new THREE.Box3().setFromPoints(all).getCenter(new THREE.Vector3());
    this.key.position.copy(mid).addScaledVector(v.dir.clone().add(up.clone().multiplyScalar(1.3)).addScaledVector(right, -0.8).normalize(), r * 4);
    this.key.target.position.copy(mid);
    this.fill.position.copy(mid).addScaledVector(v.dir.clone().addScaledVector(right, 1).normalize(), r * 4);
    this.fill.target.position.copy(mid);
    const sc = this.key.shadow.camera, size = r * 1.3;
    Object.assign(sc, { left: -size, right: size, top: size, bottom: -size, near: r, far: r * 8 });
    sc.updateProjectionMatrix();
    this.key.shadow.mapSize.set(2048, 2048);
    this.floor.visible = v.floor;
    this.floor.scale.setScalar(r * 8); this.floor.position.set(0, 0, 0);
    for (const l of this.lines) l.material.resolution.set(w, h);
    this.gl.render(this.scene, cam);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const x = out.getContext('2d')!;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(this.gl.domElement, 0, 0, w, h);
    const mw = this.root.matrixWorld.clone(), pv = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    return {
      canvas: out,
      project: (px, py, pz) => { const q = new THREE.Vector3(px, py * PL, -pz).applyMatrix4(mw).applyMatrix4(pv); return [((q.x + 1) / 2) * w, ((1 - q.y) / 2) * h]; },
    };
  }

  /** Step `si` (0-based) in a w × h view. */
  step(si: number, w: number, h: number): Shot {
    const [st, dy] = this.stepState(si), v = this.viewOf(si);
    this.show(st, () => true, dy);
    return this.shoot(w, h, v, v.fit ?? null);
  }

  /** Step `si` close up: framed on the pieces `focus` and `pad` studs around them (within `box`, x0 z0 x1 z1 studs, and
   *  `pad` around it, when set), turned `turn`° further. */
  stepZoom(si: number, focus: number[], w: number, h: number, pad = 3, turn = 0, box: [number, number, number, number] | null = null): Shot {
    const [st, dy] = this.stepState(si), v = this.viewOf(si);
    this.show(st, () => true, dy);
    v.dir.applyAxisAngle(v.up, (turn * Math.PI) / 180);
    return this.shoot(w, h, { ...v, margin: 0.02 }, this.around(focus, pad, this.sub(si) ? -this.lift : 0, box));
  }

  /** The raised ribbon, finished, `up` plates above its place, over the base and its clear supports (outlined). */
  place(w: number, h: number, up: number): Shot {
    const P = this.m.pieces, rib = new Set(this.ribbon), first = Math.min(...this.ribbon.map(i => this.stepOf[i]));
    this.show(i => (rib.has(i) || P[i].support ? 2 : this.stepOf[i] < first ? 1 : 0), i => !!P[i].support, i => (rib.has(i) ? up : 0));
    const { az } = stepAngles(this.m);
    return this.shoot(w, h, { dir: dirOf(az, 26), up: new THREE.Vector3(0, 1, 0), fov: 24, flip: false, floor: true, margin: 0.04 }, null, this.corners(this.ribbon, up));
  }

  /** The finished model close up on `focus`, from the step camera. */
  finishedZoom(focus: number[], w: number, h: number, pad = 4): Shot {
    this.show(() => 2, () => false);
    const { az, el } = stepAngles(this.m);
    return this.shoot(w, h, { dir: dirOf(az, el), up: new THREE.Vector3(0, 1, 0), fov: 24, flip: false, floor: true, margin: 0.02 }, this.around(focus, pad));
  }

  /** the corners of the box around pieces `ids`, moved up `dy` plates */
  private corners(ids: number[], dy = 0): P3[] {
    const P = ids.map(i => this.m.pieces[i]), lo = (f: (p: Piece) => number) => Math.min(...P.map(f)), hi = (f: (p: Piece) => number) => Math.max(...P.map(f)), out: P3[] = [];
    for (const x of [lo(p => p.x), hi(p => p.x + p.w)]) for (const y of [lo(p => p.y), hi(p => p.y + p.h)]) for (const z of [lo(p => p.z), hi(p => p.z + p.d)]) out.push([x, y + dy, z]);
    return out;
  }

  /** corners of the pieces' box grown by `pad` studs (and plates up and down), kept within the model's box (and `clip`,
   *  x0 z0 x1 z1 grown by `pad`), moved up `dy` plates */
  private around(ids: number[], pad: number, dy = 0, clip: [number, number, number, number] | null = null): P3[] {
    const P = ids.map(i => this.m.pieces[i]), A = this.m.pieces, out: P3[] = [], [cx0, cz0, cx1, cz1] = clip ?? [-Infinity, -Infinity, Infinity, Infinity];
    const lo = (f: (p: Piece) => number) => Math.min(...A.map(f)), hi = (f: (p: Piece) => number) => Math.max(...A.map(f));
    const x0 = Math.max(lo(p => p.x), Math.min(...P.map(p => p.x)) - pad, cx0 - pad), x1 = Math.min(hi(p => p.x + p.w), Math.max(...P.map(p => p.x + p.w)) + pad, cx1 + pad);
    const z0 = Math.max(lo(p => p.z), Math.min(...P.map(p => p.z)) - pad, cz0 - pad), z1 = Math.min(hi(p => p.z + p.d), Math.max(...P.map(p => p.z + p.d)) + pad, cz1 + pad);
    const y0 = Math.max(lo(p => p.y), Math.min(...P.map(p => p.y)) - pad), y1 = Math.min(hi(p => p.y + p.h), Math.max(...P.map(p => p.y + p.h)) + pad);
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y + dy, z]);
    return out;
  }

  /** Frame: its back as hung, seen from behind and a little to the side: the hanging points outlined. `extra`:
   *  model points to keep in view too (the hooks; on a close-up of the pieces `zoom`, the fixing above them). */
  hanging(w: number, h: number, extra: P3[] = [], zoom: number[] | null = null): Shot {
    const hp = new Set(this.m.hanging?.points ?? []), P = this.m.pieces;
    this.show(i => (P[i].y < 0 ? 2 : 1), i => hp.has(i));
    // behind the wall is model −y, up is model +z: three −Y and −Z
    const back = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 0, -1), side = new THREE.Vector3(1, 0, 0);
    const a = (28 * Math.PI) / 180, e = (16 * Math.PI) / 180;
    const dir = back.multiplyScalar(Math.cos(e) * Math.cos(a)).addScaledVector(side, Math.cos(e) * Math.sin(a)).addScaledVector(up, Math.sin(e)).normalize();
    const v = { dir, up, fov: 24, flip: false, floor: false, margin: zoom ? 0.02 : 0.08 };
    this.tone(true);
    try { return zoom ? this.shoot(w, h, v, [...this.around(zoom, 2.5), ...extra]) : this.shoot(w, h, v, null, extra); } finally { this.tone(false); }
  }

  /** Free this model's GPU data, and the shared WebGL context with the last StepRender. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.forEach(d => d.dispose());
    this.lines.forEach(l => l.geometry.dispose());
    this.hole.dispose(); this.floor.geometry.dispose(); (this.floor.material as THREE.Material).dispose();
    this.scene.environment?.dispose();
    this.key.shadow.dispose();
    release(this.ctx);
  }
}
