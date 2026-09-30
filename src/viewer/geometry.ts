// Geometry of one piece type (brick, plate, tile, curved slope, Technic brick,
// round 1×1), cached by shape. Technic bricks carry two groups: body (0) and
// the dark insides of the pin holes (1), for a two-material mesh. Studs can be
// left out and drawn apart: only those not hidden under a piece (openStuds), or
// all of them with the piece resting on each (studCells, for the build animation).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Piece } from '../core/parts';
import { PL } from './timeline';

const cache = new Map<string, THREE.BufferGeometry>();

export const geoKey = (p: Piece) => `${p.kind}${p.w}x${p.d}${p.dir ?? ''}${p.kind === 'round' ? 'h' + p.h : ''}`;

const clean = (q: THREE.BufferGeometry) => { const r = q.index ? q.toNonIndexed() : q; if (r.attributes.uv) r.deleteAttribute('uv'); return r; };

function studs(p: Piece, h: number, lowPoly: boolean, parts: THREE.BufferGeometry[]) {
  for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) {
    const c = new THREE.CylinderGeometry(0.3, 0.3, 0.17, lowPoly ? 8 : 12);
    c.translate(i - p.w / 2 + 0.5, h + 0.085, j - p.d / 2 + 0.5);
    parts.push(c);
  }
}

/** One stud standing on y = 0, centred on x and z. */
export function studGeometry(lowPoly = false): THREE.BufferGeometry {
  const k = 'stud' + (lowPoly ? 'L' : '');
  if (!cache.has(k)) cache.set(k, new THREE.CylinderGeometry(0.3, 0.3, 0.17, lowPoly ? 8 : 12).translate(0, 0.085, 0));
  return cache.get(k)!;
}

const hasStuds = (p: Piece) => p.kind !== 'tile' && p.kind !== 'slope';

/** Studs no piece rests on, by colour: [x, y, z] cell centre (y = top of the piece, in plates). Hidden studs
 *  would peek through the gaps between stacked pieces and alias into dots. */
export function openStuds(pieces: Piece[]): Map<number, [number, number, number][]> {
  const bottoms = new Set<string>(), out = new Map<number, [number, number, number][]>();
  for (const p of pieces) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) bottoms.add(`${p.x + i},${p.z + j},${p.y}`);
  for (const p of pieces) if (hasStuds(p)) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) {
    if (bottoms.has(`${p.x + i},${p.z + j},${p.y + p.h}`)) continue;
    if (!out.has(p.c)) out.set(p.c, []);
    out.get(p.c)!.push([p.x + i + 0.5, p.y + p.h, p.z + j + 0.5]);
  }
  return out;
}

export interface StudCell { owner: number; cover: number; c: number; x: number; y: number; z: number }

/** Every stud: its piece, the piece resting on it (−1 if none), colour and cell centre (y = top of the piece, in
 *  plates). For a build animation, where a stud shows until the piece above it lands. */
export function studCells(pieces: Piece[]): StudCell[] {
  const bottoms = new Map<string, number>(), out: StudCell[] = [];
  pieces.forEach((p, k) => { for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++) bottoms.set(`${p.x + i},${p.z + j},${p.y}`, k); });
  pieces.forEach((p, k) => {
    if (hasStuds(p)) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.d; j++)
      out.push({ owner: k, cover: bottoms.get(`${p.x + i},${p.z + j},${p.y + p.h}`) ?? -1, c: p.c, x: p.x + i + 0.5, y: p.y + p.h, z: p.z + j + 0.5 });
  });
  return out;
}

/** tight: stacked pieces almost touch (a live view seen from afar: the slit between them would alias into dots);
 *  flush: pieces side by side meet at a hairline, their edges barely rounded (a panel of plates reads as one) */
export function pieceGeometry(p: Piece, lowPoly = false, withStuds = true, tight = false, flush = false): THREE.BufferGeometry {
  const k = geoKey(p) + (lowPoly ? 'L' : '') + (withStuds ? '' : 'N') + (tight ? 'T' : '') + (flush ? 'F' : '');
  const hit = cache.get(k);
  if (hit) return hit;
  let parts: THREE.BufferGeometry[];
  let holes: THREE.BufferGeometry[] = [];
  if (p.kind === 'slope') {
    // curved slope 2×2: flat at one side, rounding down to the open side
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(2, 0); sh.lineTo(2, 0.08); sh.quadraticCurveTo(1.95, 0.78, 0, 0.78); sh.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.97, bevelEnabled: false, curveSegments: lowPoly ? 6 : 10 });
    g.translate(-1, 0.001, -0.985);
    g.rotateY({ E: 0, W: Math.PI, N: -Math.PI / 2, S: Math.PI / 2 }[p.dir ?? 'E']);
    parts = [g];
  } else if (p.kind === 'round') {
    const h = p.h * PL;
    const body = new THREE.CylinderGeometry(0.475, 0.475, h - 0.02, lowPoly ? 14 : 24);
    body.translate(0, h / 2, 0);
    parts = [body];
    if (withStuds) studs(p, h, lowPoly, parts);
  } else {
    const h = p.h * PL;
    const gap = flush ? 0.006 : 0.03, body = new RoundedBoxGeometry(p.w - gap, h - (tight ? 0.004 : 0.02), p.d - gap, lowPoly ? 1 : 2, Math.min(flush ? 0.01 : 0.035, h / 4));
    body.translate(0, h / 2, 0);
    parts = [body];
    if (withStuds && hasStuds(p)) studs(p, h, lowPoly, parts);
    if (p.kind === 'technic') {
      // pin holes on both long sides, between the studs: a raised rim and a dark hole
      const alongZ = p.d >= p.w, n = Math.max(p.w, p.d), half = (alongZ ? p.w : p.d) / 2 - 0.015, hy = h * 0.6;
      for (let i = 1; i < n; i++) for (const s of [-1, 1]) {
        const t = i - n / 2;
        const rim = new THREE.TorusGeometry(0.3, 0.04, lowPoly ? 4 : 6, lowPoly ? 12 : 20);
        const hole = new THREE.CircleGeometry(0.27, lowPoly ? 12 : 20);
        hole.translate(0, 0, 0.004);
        for (const g of [rim, hole]) {
          if (alongZ) { g.rotateY(s * Math.PI / 2); g.translate(s * half, hy, t); }
          else { if (s < 0) g.rotateY(Math.PI); g.translate(t, hy, s * half); }
        }
        parts.push(rim); holes.push(hole);
      }
    }
  }
  let g = mergeGeometries(parts.map(clean))!;
  if (holes.length) g = mergeGeometries([g, mergeGeometries(holes.map(clean))!], true)!;
  g.computeBoundingSphere();
  cache.set(k, g);
  return g;
}
