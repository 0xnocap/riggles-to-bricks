// Independent check of the Squiggle builders, from the pieces alone: neither core/check nor the builders'
// own rules are trusted. Every fixture as Mosaic small/large and as Relief Frame, Floating and Backdrop
// small/large (smooth top, and the studded look): structure, supports, wall, one ribbon for all displays,
// steps, parts list, colour order along the line, build time.
// Run: npx tsx scripts/verify-squiggle.ts [id,id,...] [--smooth] [--dir fixtures/] [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { elementId } from '../src/core/lego';
import { COLOR_BY_ID, TRANS_CLEAR } from '../src/core/palette';
import { partId, partName, type Piece } from '../src/core/parts';
import { arcLength, readCurve, type Curve, type CurveSource, type SquiggleType } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import { PLATE_CM, STUD_CM, type Display, type Scale, type SqModel } from '../src/squiggle/model';
import { buildMosaic } from '../src/squiggle/mosaic';
import { partGrams, partPrice } from '../src/squiggle/partinfo';
import { buildRibbon, endCap, type Ribbon } from '../src/squiggle/ribbon';
import { BLACK, SPECTRUM, WHITE, curveColors } from '../src/squiggle/spectrum';

type Owner = 'mosaic' | 'ribbon' | 'display' | 'stage' | 'partinfo' | 'nameplate';
interface Fail { owner: Owner; where: string; check: string; detail: string }
type Src = CurveSource & { hash: string };
type Pt = { x: number; z: number; s: number };

// the brief's numbers (docs/DESIGN-squiggle.md), not the builders'
const GRID: Record<Scale, [number, number]> = { small: [64, 32], large: [96, 48] };
const PANEL: Record<Scale, [number, number]> = { small: [48, 24], large: [64, 32] };
const WIDTH: Record<SquiggleType, number> = { Normal: 3, Slinky: 3, Ribbed: 3, Fuzzy: 4, Bold: 7, Pipe: 5 };
const SOCLE_W = [48, 64, 80], SOCLE_D = [24, 32, 40, 48], LIMIT_MS = 1500, GAP = 8, TIP = 2;
const DISPLAYS: Display[] = ['frame', 'floating', 'backdrop'];
const SPEC = new Map(SPECTRUM.map((s, i) => [s.id, i])), N = SPECTRUM.length;

const argv = process.argv.slice(2), ji = argv.indexOf('--json'), di = argv.indexOf('--dir'), DIR = di >= 0 ? argv[di + 1] : 'test/fixtures/squiggles';
const pos = argv.filter((a, i) => !a.startsWith('--') && !((ji >= 0 && i === ji + 1) || (di >= 0 && i === di + 1)));
const IDS = pos[0] ? pos[0].split(',').map(Number) : readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => +f.slice(0, -5)).sort((a, b) => a - b);
const LOOKS = argv.includes('--smooth') ? [false] : [false, true];

const fails: Fail[] = [], info = new Map<string, string[]>(), rows: { where: string; pieces: number; floating: number; collisions: number; ms: number; grams: number }[] = [];
const fail = (owner: Owner, where: string, check: string, detail: string) => { fails.push({ owner, where, check, detail }); };
const note = (topic: string, s: string) => { if (!info.has(topic)) info.set(topic, []); info.get(topic)!.push(s); };
const some = (a: unknown[], n = 5) => a.slice(0, n).join('; ') + (a.length > n ? ` … (${a.length} in all)` : '');
const cname = (c: number) => COLOR_BY_ID.get(c)?.name ?? `colour ${c}`;
const say = (P: Piece[], i: number) => { const p = P[i]; return `#${i} ${p.kind} ${p.w}×${p.d}×${p.h} ${cname(p.c)} x${p.x} z${p.z} y${p.y}`; };
const now = () => performance.now();
const TABLE = new Set([...readFileSync('src/squiggle/partinfo.ts', 'utf8').matchAll(/'?(\w+)'?: \[[\d.]+, [\d.]+\]/g)].map(m => m[1]));

// ---- cells, contacts, studs ----
const K = (x: number, z: number) => (x + 512) * 1024 + (z + 512);
const KX = (k: number) => Math.floor(k / 1024) - 512, KZ = (k: number) => (k % 1024) - 512;
const foot = (p: Piece) => { const o: number[] = []; for (let a = 0; a < p.w; a++) for (let b = 0; b < p.d; b++) o.push(K(p.x + a, p.z + b)); return o; };
const studded = (p: Piece) => p.kind !== 'tile' && p.kind !== 'slope';
const ids = (P: Piece[], f: (p: Piece, i: number) => boolean) => P.flatMap((p, i) => (f(p, i) ? [i] : []));
const box = (ps: Piece[]) => ({
  x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x + p.w)), z0: Math.min(...ps.map(p => p.z)),
  z1: Math.max(...ps.map(p => p.z + p.d)), y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y + p.h)),
});
const area = (ps: Piece[]) => ps.reduce((n, p) => n + p.w * p.d, 0);
const disc = (X: number, Z: number, R: number, f: (c: number) => void) => {
  for (let x = Math.ceil(X - R - 0.5); x <= Math.floor(X + R - 0.5); x++) for (let z = Math.ceil(Z - R - 0.5); z <= Math.floor(Z + R - 0.5); z++)
    if ((x + 0.5 - X) ** 2 + (z + 0.5 - Z) ** 2 <= R * R) f(K(x, z));
};

/** unit-cell occupancy (x, z, y), who touches whom above/below, studs engaged from below, stud links */
function geom(P: Piece[]) {
  const occ = new Map<number, number>(), clash = new Map<number, [number, number]>();
  P.forEach((p, i) => { for (const c of foot(p)) for (let y = p.y; y < p.y + p.h; y++) { const k = c * 256 + y + 64, o = occ.get(k); if (o === undefined) occ.set(k, i); else if (!clash.has(k)) clash.set(k, [o, i]); } });
  const at = (c: number, y: number) => occ.get(c * 256 + y + 64);
  const below = P.map(() => new Map<number, number>()), above = P.map(() => new Map<number, number>()), studs = P.map(() => 0), adj = P.map(() => new Set<number>());
  P.forEach((p, i) => {
    for (const c of foot(p)) {
      const j = at(c, p.y - 1);
      if (j === undefined || j === i || P[j].y + P[j].h !== p.y) continue;
      below[i].set(j, (below[i].get(j) ?? 0) + 1); above[j].set(i, (above[j].get(i) ?? 0) + 1);
      if (studded(P[j])) { studs[i]++; adj[i].add(j); adj[j].add(i); }
    }
  });
  const clashes = [...clash].map(([k, [a, b]]) => `${say(P, a)} / ${say(P, b)} at ${KX(Math.floor(k / 256))},${KZ(Math.floor(k / 256))},y${(k % 256) - 64}`);
  return { clashes, pairs: [...clash.values()], at, below, above, studs, adj };
}
type Geom = ReturnType<typeof geom>;
function flood(adj: Set<number>[], from: Iterable<number>, keep: (i: number) => boolean = () => true) {
  const seen = new Set(from), st = [...seen];
  while (st.length) for (const n of adj[st.pop()!]) if (!seen.has(n) && keep(n)) { seen.add(n); st.push(n); }
  return seen;
}
function bodies(adj: Set<number>[], set: number[]) {
  const inSet = new Set(set), done = new Set<number>(), out: number[][] = [];
  for (const i of set) if (!done.has(i)) { const b = flood(adj, [i], n => inSet.has(n)); b.forEach(n => done.add(n)); out.push([...b]); }
  return out;
}
/** edges shared by two `base` pieces, and those crossed by a single `top` piece along less than half of their length */
function openSeams(base: Piece[], top: Piece[]) {
  const bo = new Map<number, number>(), to = new Map<number, number>();
  base.forEach((p, i) => foot(p).forEach(c => bo.set(c, i)));
  top.forEach((p, i) => foot(p).forEach(c => to.set(c, i)));
  const s = new Map<string, { n: number; x: number; at: string }>();
  for (const [c, i] of bo) for (const o of [1024, 1]) {
    const j = bo.get(c + o);
    if (j === undefined || j === i) continue;
    const id = `${Math.min(i, j)}/${Math.max(i, j)}/${o}`, e = s.get(id) ?? { n: 0, x: 0, at: o === 1 ? `z=${KZ(c) + 1}` : `x=${KX(c) + 1}` };
    e.n++;
    if (to.has(c) && to.get(c) === to.get(c + o)) e.x++;
    s.set(id, e);
  }
  const all = [...s.values()];
  return { n: all.length, open: all.filter(e => 2 * e.x < e.n).map(e => `${e.at} crossed ${e.x}/${e.n}`), cells: new Set([...bo].filter(([c, i]) => [1024, -1024, 1, -1].some(o => bo.has(c + o) && bo.get(c + o) !== i)).map(([c]) => c)) };
}
const sig = (ps: Piece[]) => { const b = box(ps); return ps.map(p => `${p.x - b.x0},${p.z - b.z0},${p.y - b.y0},${p.w},${p.d},${p.h},${p.c},${p.kind},${p.part}`).sort().join('|'); };

// ---- checks every model gets ----
function common(m: SqModel, G: Geom, where: string, own: Owner, roots: number[], src: Src, blame: (i: number) => Owner) {
  const P = m.pieces;
  if (G.clashes.length) fail(G.pairs.every(([a, b]) => blame(a) === 'ribbon' && blame(b) === 'ribbon') ? 'ribbon' : own, where, 'collisions', `${G.clashes.length} unit cells taken twice: ${some(G.clashes, 3)}`);
  if (!roots.length) fail(own, where, 'root', 'no root pieces (black plates at y 0)');
  const got = flood(G.adj, roots), lost = ids(P, (_, i) => !got.has(i));
  if (lost.length) fail(lost.every(i => blame(i) === 'ribbon') ? 'ribbon' : own, where, 'floating', `${lost.length} pieces not linked by studs to the root: ${some(lost.map(i => say(P, i)), 4)}`);
  const parts = bodies(G.adj, P.map((_, i) => i));
  if (parts.length > 1) fail(own, where, 'one body', `the model is ${parts.length} separate bodies (sizes ${parts.map(b => b.length).sort((a, b) => b - a).slice(0, 6).join(', ')})`);
  if ((m.checks.floating === 0) !== (lost.length === 0) || (m.checks.collisions === 0) !== (G.clashes.length === 0))
    fail(own, where, 'reported checks', `builder reports ${m.checks.floating} floating / ${m.checks.collisions} collisions; recount ${lost.length} / ${G.clashes.length}`);
  if (m.checks.pieces !== P.length) fail(own, where, 'reported checks', `checks.pieces ${m.checks.pieces}, ${P.length} pieces`);
  for (const r of m.checks.rules) if (!r.ok) fail(own, where, `own rule "${r.name}"`, r.detail ?? '');

  const noRole = ids(P, p => p.role !== 'squiggle' && p.role !== 'display');
  if (noRole.length) fail(own, where, 'roles', `${noRole.length} pieces without role: ${some(noRole.map(i => say(P, i)))}`);
  const bad = ids(P, p => !(p.w >= 1 && p.d >= 1 && p.h >= 1 && [p.x, p.y, p.z, p.w, p.d, p.h].every(Number.isInteger)) || (() => { try { return partId(p.kind, p.w, p.d, p.h) !== p.part; } catch { return true; } })()
    || p.h !== (p.kind === 'plate' || p.kind === 'tile' || (p.kind === 'round' && p.part === '6141') ? 1 : 3) || !COLOR_BY_ID.has(p.c));
  if (bad.length) fail(own, where, 'piece shape', `${bad.length} pieces with a bad size, height, colour or part number: ${some(bad.map(i => `${say(P, i)} part ${P[i].part}`))}`);

  // steps: every piece once; a piece never before one it rests on (under the root: hangs from)
  const step = new Int32Array(P.length).fill(-1), dup: number[] = [], wrong: unknown[] = [];
  m.steps.forEach((s, k) => s.forEach(i => { if (!Number.isInteger(i) || i < 0 || i >= P.length) wrong.push(i); else if (step[i] >= 0) dup.push(i); else step[i] = k; }));
  const missing = ids(P, (_, i) => step[i] < 0), empty = m.steps.filter(s => !s.length).length;
  if (missing.length || dup.length || wrong.length || empty) fail(own, where, 'steps cover', `${missing.length} pieces in no step, ${dup.length} twice, ${wrong.length} bad indices, ${empty} empty steps: ${some([...missing, ...dup].map(i => say(P, i)), 3)}`);
  const rootSet = new Set(roots), rootY = roots.length ? Math.min(...roots.map(i => P[i].y)) : 0, early: string[] = [];
  P.forEach((p, i) => {
    if (rootSet.has(i) || step[i] < 0) return;
    const on = [...(p.y >= rootY ? G.below[i] : G.above[i]).keys()], later = on.filter(j => step[j] > step[i]);
    if (later.length) early.push(`${say(P, i)} (step ${step[i] + 1}) on ${say(P, later[0])} (step ${step[later[0]] + 1})`);
  });
  if (early.length) fail(own, where, 'step order', `${early.length} pieces placed before a piece they rest on: ${some(early, 3)}`);
  for (const k of Object.keys(m.stepNotes)) if (!m.steps[+k]) fail(own, where, 'step notes', `note on step ${+k + 1} of ${m.steps.length}`);

  // summarize: parts list, subtotals, weight, cost, size, colours, recounted from the pieces
  const lines = new Map<string, Piece[]>();
  for (const p of P) { const k = `${p.part}|${p.c}|${p.role}`; if (!lines.has(k)) lines.set(k, []); lines.get(k)!.push(p); }
  const bomBy = new Map(m.bom.map(l => [`${l.part}|${l.color}|${l.role}`, l]));
  const diff = [...new Set([...lines.keys(), ...bomBy.keys()])].filter(k => lines.get(k)?.length !== bomBy.get(k)?.qty);
  if (diff.length || bomBy.size !== m.bom.length) fail(own, where, 'summarize bom', `${diff.length} lines differ: ${some(diff.map(k => `${k} ${lines.get(k)?.length ?? 0} pieces vs qty ${bomBy.get(k)?.qty ?? 0}`))}`);
  const lineBad: string[] = [];
  for (const l of m.bom) {
    const ps = lines.get(`${l.part}|${l.color}|${l.role}`);
    if (!ps) continue;
    const p = ps[0], g = partGrams(p.part, p.kind, p.w, p.d, p.h), e = partPrice(p.part, p.kind, p.w, p.d, p.h);
    const why = [l.grams !== g && `grams ${l.grams} vs ${g}`, l.price !== e && `price ${l.price} vs ${e}`, l.name !== partName(p.kind, p.w, p.d, p.h) && `name ${l.name}`,
      l.colorName !== cname(l.color) && `colour ${l.colorName}`, l.hex !== COLOR_BY_ID.get(l.color)?.hex && `hex ${l.hex}`, l.kind !== p.kind && `kind ${l.kind}`,
      (l.w !== Math.min(p.w, p.d) || l.d !== Math.max(p.w, p.d) || l.h !== p.h) && `size ${l.w}×${l.d}×${l.h}`,
      ps.some(q => !!q.support !== l.hidden) && `hidden ${l.hidden}`].filter(Boolean);
    if (why.length) lineBad.push(`${l.part} ${l.colorName} ${l.role}: ${why.join(', ')}`);
  }
  if (lineBad.length) fail(own, where, 'summarize lines', some(lineBad));
  let tg = 0, tc = 0;
  for (const role of ['squiggle', 'display'] as const) {
    const ps = P.filter(p => p.role === role), s = m.subtotals[role];
    const g = ps.reduce((a, p) => a + partGrams(p.part, p.kind, p.w, p.d, p.h), 0), e = ps.reduce((a, p) => a + partPrice(p.part, p.kind, p.w, p.d, p.h), 0);
    const lots = new Set(ps.map(p => `${p.part}|${p.c}`)).size;
    tg += g; tc += e;
    if (s.pieces !== ps.length || s.lots !== lots || Math.abs(s.grams - g) > 0.51 || Math.abs(s.cost - e) > 0.51)
      fail(own, where, 'summarize subtotals', `${role}: ${s.pieces} pieces, ${s.lots} lots, ${s.grams} g, ${s.cost} € reported; recount ${ps.length}, ${lots}, ${g.toFixed(1)} g, ${e.toFixed(1)} €`);
  }
  if (Math.abs(m.grams - tg) > 1.01 || Math.abs(m.cost - tc) > 1.01) fail(own, where, 'summarize totals', `${m.grams} g / ${m.cost} € reported, recount ${tg.toFixed(1)} g / ${tc.toFixed(1)} €`);
  const b = box(P), W = (b.x1 - b.x0) * STUD_CM, D = (b.z1 - b.z0) * STUD_CM, H = (b.y1 - b.y0) * PLATE_CM, dims = m.pose === 'wall' ? [W, H, D] : [W, D, H];
  if (dims.some((v, i) => Math.abs(v - m.dims[i]) > 0.051)) fail(own, where, 'summarize dims', `${m.dims.join(' × ')} cm reported, recount ${dims.map(v => v.toFixed(2)).join(' × ')} (pose ${m.pose})`);
  const cols = [...new Set(P.map(p => p.c))].sort((x, y) => x - y).join(), theirCols = Object.keys(m.colors).map(Number).sort((x, y) => x - y).join();
  if (cols !== theirCols) fail(own, where, 'summarize colours', `${theirCols} reported, pieces use ${cols}`);

  // every part + colour sold by LEGO (Element ID) or named in the notes
  const notes = m.notes.join(' '), unsold = new Map<string, Piece>();
  for (const p of P) if (!elementId(p.part, p.c)) unsold.set(`${p.part}|${p.c}`, p);
  const silent = [...unsold.values()].filter(p => !notes.includes(`${partName(p.kind, p.w, p.d, p.h)} ${cname(p.c)}`));
  if (silent.length) fail(own, where, 'element IDs', `no Element ID and not listed in the notes: ${some(silent.map(p => `${p.part} ${partName(p.kind, p.w, p.d, p.h)} ${cname(p.c)}`))}`);
  if (unsold.size) note('Parts without an Element ID (listed in the notes)', `${where}: ${[...unsold.values()].map(p => `${p.part} ${cname(p.c)}`).join(', ')}`);
  const guessed = [...new Set(P.map(p => p.part))].filter(q => !TABLE.has(q));
  if (guessed.length) fail('partinfo', where, 'part table', `parts weighed and priced by the fallback rule, not the researched table: ${guessed.join(', ')}`);

  // nameplate: one black 2×6 tile 69729, role display, the two lines of the brief
  const want = [`Chromie Squiggle #${src.id}`, `Snowfro · Art Blocks · 2020 · 0x${src.hash.replace(/^0x/, '').slice(0, 8)}`];
  const nps = ids(P, p => !!p.nameplate), np = m.nameplate ? P[m.nameplate.piece] : undefined;
  if (!m.nameplate || !np) fail(own, where, 'nameplate', 'no nameplate');
  else {
    if (m.nameplate.lines.join('\n') !== want.join('\n')) fail('nameplate', where, 'nameplate text', `"${m.nameplate.lines.join(' / ')}", expected "${want.join(' / ')}"`);
    if (nps.length !== 1 || nps[0] !== m.nameplate.piece || np.kind !== 'tile' || np.part !== '69729' || np.c !== BLACK || np.role !== 'display' || np.w * np.d !== 12 || Math.min(np.w, np.d) !== 2)
      fail(own, where, 'nameplate piece', `${nps.length} nameplate pieces, piece ${m.nameplate.piece}: ${say(P, m.nameplate.piece)} part ${np.part} role ${np.role}`);
  }
  return { floating: lost.length };
}

// ---- colours along the centre line ----
type Smp = Pt & { i: number };
const dense = (line: Pt[], step = 0.25) => {
  const o: Smp[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let j = 0; j < n; j++) o.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n, s: a.s + ((b.s - a.s) * j) / n, i: 2 * j < n ? i : i + 1 });
  }
  o.push({ ...line[line.length - 1], i: line.length - 1 });
  return o;
};
const gap = (a: number, b: number) => { const d = Math.abs(SPEC.get(a)! - SPEC.get(b)!); return Math.min(d, N - d); };
/**
 * Spectrum skips in the top colours met walking the centre line. The walk reads the cell under each sample
 * where this stretch of line is the one on top: no sample more than `far` further along the line covers the
 * cell (within r). A cell showing another pass's colour (> 1 step from this pass's, ≤ 1 from the other's) is
 * hidden too. Each cell read takes its colour from a point of the line, its source (Mosaic, `last`: the last
 * sample covering it; Relief: the nearest sample of the pass). Consecutive colours read must be 1 palette
 * step apart (circular); across hidden cells, as many as the reference colours (`refs`, per line point) make
 * between the two sources. A colour skipped on the centre line but shown on this stretch's own cells (within r
 * of the line from the first source to the second: a hairpin's legs share cells) is not lost.
 */
function colourWalk(line: Pt[], refs: number[][], top: (c: number) => number | undefined, r: number, far: number, last: boolean) {
  const S = dense(line), cover = new Map<number, number[]>(), s = line.map(p => p.s);
  S.forEach((p, i) => disc(p.x, p.z, r, c => { const l = cover.get(c); if (l) l.push(i); else cover.set(c, [i]); }));
  const d2 = (j: number, c: number) => (S[j].x - KX(c) - 0.5) ** 2 + (S[j].z - KZ(c) - 0.5) ** 2;
  const cum = refs.map(ref => { const o = [0]; for (let i = 1; i < ref.length; i++) o.push(o[i - 1] + (SPEC.has(ref[i]) && SPEC.has(ref[i - 1]) ? gap(ref[i], ref[i - 1]) : 0)); return o; });
  const idx = (v: number) => { let lo = 0, hi = s.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const steps = (a: number, b: number) => Math.max(...cum.map(c => c[idx(b)] - c[idx(a)]));
  const owned = (c: number, i: number) => { const l = cover.get(c); return !!l && S[l[l.length - 1]].s - S[i].s <= far; };
  const skips: string[] = [];
  let prev: { s: number; f: number; c: number; at: number; i: number; j: number } | null = null, hidden = false, read = 0, trimmed = 0, off = 0, under = 0, lastCell = -1;
  for (let i = 0; i < S.length; i++) {
    const p = S[i], c = K(Math.floor(p.x), Math.floor(p.z));
    if (c === lastCell) continue;
    lastCell = c;
    const col = top(c), l = cover.get(c) ?? [];
    if (!owned(c, i)) { hidden = true; continue; }
    if (col === undefined) { trimmed++; hidden = true; continue; }
    if (!SPEC.has(col)) continue;
    const mine = l.filter(j => Math.abs(S[j].s - p.s) <= far), j = last ? l[l.length - 1] : mine.reduce((u, v) => (d2(v, c) < d2(u, c) ? v : u), mine[0]);
    if (refs.every(ref => gap(col, ref[S[j].i]) > 1)) {
      if (l.some(q => Math.abs(S[q].s - S[j].s) > far && refs.some(ref => gap(col, ref[S[q].i]) <= 1))) { under++; hidden = true; continue; }
      off++;
    }
    read++;
    if (prev && prev.c !== col) {
      const n = gap(col, prev.c), may = hidden ? Math.max(1, steps(Math.min(prev.f, S[j].s), Math.max(prev.f, S[j].s))) : 1;
      if (n > may) {
        const dir = (SPEC.get(col)! - SPEC.get(prev.c)! + N) % N <= N / 2 ? 1 : -1, seen = new Set<number>();
        for (let k = Math.min(prev.i, prev.j); k <= Math.max(i, j); k++) disc(S[k].x, S[k].z, r, q => { const t = top(q); if (t !== undefined && owned(q, k)) seen.add(t); });
        const lost: number[] = [];
        for (let k = 1; k < n; k++) { const m = SPECTRUM[(SPEC.get(prev.c)! + dir * k + N) % N].id; if (!seen.has(m)) lost.push(m); }
        if (lost.length) skips.push(`${cname(prev.c)} at ${KX(prev.at)},${KZ(prev.at)} (line s ${prev.s.toFixed(1)}, colour from s ${prev.f.toFixed(1)}) → ${cname(col)} at ${KX(c)},${KZ(c)} (line s ${p.s.toFixed(1)}, colour from s ${S[j].s.toFixed(1)}): ${lost.map(cname).join(', ')} missing${hidden ? ' (after hidden cells)' : ''}`);
      }
    }
    prev = { s: p.s, f: S[j].s, c: col, at: c, i, j };
    hidden = false;
  }
  return { skips, read, trimmed, off, under };
}

// ---- Mosaic ----
function mosaicCheck(m: SqModel, curve: Curve, scale: Scale, where: string, src: Src) {
  const P = m.pieces, G = geom(P), [W, H] = GRID[scale];
  const base = ids(P, p => p.y === 0 && p.kind === 'plate');
  const { floating } = common(m, G, where, 'mosaic', base, src, () => 'mosaic');
  if (m.format !== 'mosaic' || m.display !== null || m.pose !== 'table' || m.scale !== scale) fail('mosaic', where, 'model', `format ${m.format}, display ${m.display}, pose ${m.pose}, scale ${m.scale}`);
  const bp = base.map(i => P[i]), b = box(bp);
  if (b.x0 !== 0 || b.z0 !== 0 || b.x1 !== W || b.z1 !== H || area(bp) !== W * H || bp.some(p => p.c !== BLACK || p.role !== 'display'))
    fail('mosaic', where, 'grid size', `base plates ${b.x0},${b.z0}–${b.x1},${b.z1} (${area(bp)} studs), expected 0,0–${W},${H} black, role display`);
  const odd = P.filter(p => !(p.y === 0 && p.kind === 'plate') && !(p.y === 1 && p.kind === 'tile'));
  if (odd.length) fail('mosaic', where, 'layers', `${odd.length} pieces neither base plates (y 0) nor tiles (y 1)`);
  const tiles = P.filter(p => p.y === 1 && p.kind === 'tile'), top = new Map<number, Piece>();
  for (const p of tiles) for (const c of foot(p)) top.set(c, p);
  let holes = 0;
  for (let x = 0; x < W; x++) for (let z = 0; z < H; z++) if (!top.has(K(x, z))) holes++;
  const out = [...top.keys()].filter(c => KX(c) < 0 || KX(c) >= W || KZ(c) < 0 || KZ(c) >= H).length;
  if (holes || out) fail('mosaic', where, 'tile cover', `${holes} grid cells without a tile, ${out} tile cells off the grid`);
  const sm = openSeams(bp, tiles);
  if (sm.open.length) fail('mosaic', where, 'seams bridged', `${sm.open.length} of ${sm.n} base plate seams crossed by tiles along less than half their length: ${some(sm.open)}`);
  const roleBad = tiles.filter(p => (p.c === BLACK ? p.role !== 'display' : p.role !== 'squiggle'));
  if (roleBad.length) fail('mosaic', where, 'roles', `${roleBad.length} tiles with the wrong role (coloured: squiggle, black: display)`);
  const lit = [...top].filter(([, p]) => p.c !== BLACK).map(([c]) => c);
  if (lit.length) {
    const xs = lit.map(KX), zs = lit.map(KZ), mg = [Math.min(...xs), W - 1 - Math.max(...xs), Math.min(...zs), H - 1 - Math.max(...zs)];
    if (Math.min(...mg) < 2) fail('mosaic', where, 'margins', `coloured cells to the edge: left ${mg[0]}, right ${mg[1]}, front ${mg[2]}, back ${mg[3]} (≥ 2)`);
  }
  // a 1×1 tile that merges with a neighbour of its colour in line with it into a sold tile
  const merge: string[] = [];
  let ones = 0;
  for (const p of tiles) {
    if (p.w * p.d !== 1 || p.nameplate) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => top.get(K(p.x + dx, p.z + dz))?.c === p.c)) ones++;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = top.get(K(p.x + dx, p.z + dz));
      if (!q || q.c !== p.c || q.nameplate || (dx ? q.d !== 1 : q.w !== 1)) continue;
      const len = (dx ? q.w : q.d) + 1;
      if (elementId(tryPart('tile', dx ? len : 1, dx ? 1 : len), p.c)) { merge.push(`${cname(p.c)} 1×1 at ${p.x},${p.z} + its 1×${len - 1} neighbour`); break; }
    }
  }
  if (merge.length) fail('mosaic', where, '1×1 tiles', `${merge.length} 1×1 tiles that merge with a neighbour of their colour into a sold tile: ${some(merge)}`);
  const better = retile(tiles, bp);
  if (better.length) fail('mosaic', where, '1×1 tiles', `${better.length} 1×1 tiles that a re-cut of the tiles of their colour around them avoids, every seam still bridged: ${some(better)}`);
  if (ones) note('Mosaic 1×1 tiles beside a cell of their colour', `${where}: ${ones}`);
  const first = new Set(m.steps[0] ?? []), bands = m.steps.slice(1).filter(st => st.some(i => !P[i]?.nameplate)).map(st => Math.min(...st.map(i => P[i]?.z ?? 0)));
  if (first.size !== base.length || base.some(i => !first.has(i))) fail('mosaic', where, 'steps', 'the first step is not exactly the base plates');
  if (bands.some((z, k) => k && z < bands[k - 1])) fail('mosaic', where, 'steps', `tile bands not front to back: first rows ${bands.join(', ')}`);

  // the brief's picture: fit (centre line + stroke, 2-stud margins, centred), the last point covering each cell
  const { box: bx, points } = curve, k = Math.min((W - 4) / (bx.x1 - bx.x0 + curve.stroke), (H - 4) / (bx.y1 - bx.y0 + curve.stroke));
  const pcx = (bx.x0 + bx.x1) / 2, pcy = (bx.y0 + bx.y1) / 2, r = (curve.stroke * k) / 2, arc = arcLength(points), cc = curveColors(curve, 2 / k), cap = endCap(curve, cc, 0, 1 / k);
  const line = points.map((p, i) => ({ x: W / 2 + (p.x - pcx) * k, z: H / 2 + (pcy - p.y) * k, s: arc[i] * k }));
  const lastPt = new Map<number, number>();
  line.forEach((p, i) => disc(p.x, p.z, r, c => lastPt.set(c, i)));
  const rib = curve.type === 'Ribbed' ? ((curve.ribGray ?? 0) < 128 ? BLACK : WHITE) : -1, off: string[] = [], byCap: string[] = [];
  for (const [c, p] of top) {
    if (p.nameplate) continue;
    const j = lastPt.get(c), want = j === undefined ? BLACK : cc[j];
    if (p.c === want || (j !== undefined && p.c === rib)) continue;
    const t = `${KX(c)},${KZ(c)} ${cname(p.c)} for ${cname(want)}`;
    if (j !== undefined && p.c === cap[j] && cap[j] !== cc[j]) byCap.push(t);
    else if (sm.cells.has(c)) off.push(t);
    else off.push(`${t} (off the seams)`);
  }
  const noted = +(m.notes.join(' ').match(/(\d+) cells? along base plate seams recoloured/)?.[1] ?? 0), away = off.filter(t => t.endsWith('(off the seams)'));
  if (off.length > noted || away.length) fail('mosaic', where, 'picture', `${off.length} cells differ from the brief's picture (${noted} noted as recoloured along seams), ${away.length} of them off any base plate seam: ${some([...away, ...off.filter(t => !away.includes(t))])}`);
  if (byCap.length) note('Mosaic end cap (colours before the end dot catch up with it, not curveColors)', `${where}: ${byCap.length} cells`);
  const walk = colourWalk(line, [cc, cap], c => top.get(c)?.c, r, 2 * r + 1, true);
  if (walk.skips.length) fail('mosaic', where, 'colour order', `${walk.skips.length} spectrum skips along the centre line (${walk.read} cells read): ${some(walk.skips, 4)}`);
  if (walk.off) note('Centre-line cells more than 1 step from their own line colour (no skip)', `${where}: ${walk.off}`);
  return { floating, collisions: G.clashes.length };
}
const tryPart = (kind: Piece['kind'], w: number, d: number) => { try { return partId(kind, w, d); } catch { return '-'; } };

/**
 * 1×1 colour tiles a better cut avoids: the tiles of its colour within two rings around it (≤ 40 cells) cut
 * again exactly, with sold tiles, fewer 1×1 than before, and every base plate seam still crossed along half its length.
 */
function retile(tiles: Piece[], base: Piece[]) {
  const own = new Map<number, number>(), bo = new Map<number, number>(), out: string[] = [];
  tiles.forEach((p, i) => foot(p).forEach(c => own.set(c, i)));
  base.forEach((p, i) => foot(p).forEach(c => bo.set(c, i)));
  const seamOf = (a: number, b: number) => { const i = bo.get(a), j = bo.get(b); return i === undefined || j === undefined || i === j ? null : `${Math.min(i, j)}/${Math.max(i, j)}/${Math.abs(b - a)}`; };
  const len = new Map<string, number>(), got = new Map<string, number>();
  for (const [c] of bo) for (const o of [1024, 1]) { const s = seamOf(c, c + o); if (s) { len.set(s, (len.get(s) ?? 0) + 1); if (own.get(c) === own.get(c + o)) got.set(s, (got.get(s) ?? 0) + 1); } }
  const shapes = new Map<number, [number, number][]>();
  const sold = (c: number) => { let s = shapes.get(c); if (!s) shapes.set(c, s = [[1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6]].flatMap(([a, b]): [number, number][] => (a === b ? [[a, b]] : [[a, b], [b, a]])).filter(([a, b]) => elementId(tryPart('tile', a, b), c))); return s; };
  for (const t of tiles) {
    if (t.w * t.d !== 1 || t.nameplate || t.c === BLACK) continue;
    let set = new Set([own.get(K(t.x, t.z))!]);
    for (let ring = 0; ring < 2; ring++) for (const i of [...set]) for (const c of foot(tiles[i])) for (const o of [1024, -1024, 1, -1]) { const j = own.get(c + o); if (j !== undefined && tiles[j].c === t.c && !tiles[j].nameplate) set.add(j); }
    if ([...set].reduce((n, i) => n + tiles[i].w * tiles[i].d, 0) > 40) set = new Set([...set].filter(i => Math.abs(tiles[i].x - t.x) + Math.abs(tiles[i].z - t.z) <= 3));
    const U = [...set].flatMap(i => foot(tiles[i])), inU = new Set(U), order = [...U].sort((a, b) => KZ(a) - KZ(b) || KX(a) - KX(b));
    const was = [...set].filter(i => tiles[i].w * tiles[i].d === 1).length;
    // seam crossings inside U before, to take off the totals
    const pairs: [number, number, string][] = [];
    for (const c of U) for (const o of [1024, 1]) { const s = seamOf(c, c + o); if (s && inU.has(c + o)) pairs.push([c, c + o, s]); }
    const base0 = new Map(got);
    for (const [a, b, s] of pairs) if (own.get(a) === own.get(b)) base0.set(s, base0.get(s)! - 1);
    const who = new Map<number, number>();
    let nodes = 0, found = false;
    const ok = () => { const g = new Map(base0); for (const [a, b, s] of pairs) if (who.get(a) === who.get(b)) g.set(s, g.get(s)! + 1); return [...new Set(pairs.map(p => p[2]))].every(s => 2 * g.get(s)! >= len.get(s)!); };
    const rec = (k: number, n: number, ones1: number): void => {
      if (found || ++nodes > 50000 || ones1 >= was) return;
      while (k < order.length && who.has(order[k])) k++;
      if (k === order.length) { if (ok()) found = true; return; }
      const c = order[k], x = KX(c), z = KZ(c);
      for (const [w, d] of [...sold(t.c), [1, 1] as [number, number]]) {
        const cs: number[] = [];
        for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) cs.push(K(x + a, z + b));
        if (cs.some(q => !inU.has(q) || who.has(q))) continue;
        cs.forEach(q => who.set(q, n));
        rec(k + 1, n + 1, ones1 + (w * d === 1 ? 1 : 0));
        cs.forEach(q => who.delete(q));
        if (found) return;
      }
    };
    rec(0, 0, 0);
    if (found) out.push(`${cname(t.c)} 1×1 at ${t.x},${t.z} (${set.size} tiles, ${was} of them 1×1, re-cut with fewer)`);
  }
  return out;
}

// ---- Relief ----
/** the ribbon's rules on its pieces in a model: plates/tiles, no 1×1, no overhang, whole slabs, tops, one body */
function ribbonCheck(m: SqModel, G: Geom, where: string, studs: boolean) {
  const P = m.pieces, sq = ids(P, p => p.role === 'squiggle'), y0 = Math.min(...sq.map(i => P[i].y));
  const ones = sq.filter(i => P[i].w * P[i].d === 1);
  if (ones.length) fail('ribbon', where, 'no 1×1', `${ones.length} single-stud ribbon pieces: ${some(ones.map(i => say(P, i)))}`);
  const kinds = sq.filter(i => P[i].h !== 1 || (P[i].kind !== 'plate' && P[i].kind !== 'tile'));
  if (kinds.length) fail('ribbon', where, 'ribbon parts', `${kinds.length} ribbon pieces not plates or tiles: ${some(kinds.map(i => say(P, i)))}`);
  const hang: string[] = [], topOf = new Map<number, number>();
  for (const i of sq) for (const c of foot(P[i])) {
    if (P[i].y > y0) { const j = G.at(c, P[i].y - 1); if (j === undefined || P[j].role !== 'squiggle') hang.push(`${say(P, i)} over ${KX(c)},${KZ(c)}`); }
    const t = topOf.get(c);
    if (t === undefined || P[t].y < P[i].y) topOf.set(c, i);
  }
  if (hang.length) fail('ribbon', where, 'no overhang', `${hang.length} ribbon cells over no ribbon piece: ${some(hang, 3)}`);
  const odd = [...topOf].filter(([, i]) => (P[i].y + 1 - y0) % 3 !== 0).map(([c, i]) => `${KX(c)},${KZ(c)} ${P[i].y + 1 - y0} plates`);
  if (odd.length) fail('ribbon', where, 'slabs', `${odd.length} cells whose stack is not whole 3-plate slabs: ${some(odd)}`);
  const wrongTop = [...topOf].filter(([, i]) => P[i].kind !== (studs ? 'plate' : 'tile')).map(([c, i]) => `${KX(c)},${KZ(c)} ${P[i].kind}`);
  if (wrongTop.length) fail('ribbon', where, studs ? 'studded top' : 'tiled top', `${wrongTop.length} cells topped by a ${studs ? 'tile' : 'plate'}: ${some(wrongTop)}`);
  const buried = sq.filter(i => P[i].kind === 'tile' && G.above[i].size);
  if (buried.length) fail('ribbon', where, 'tiles under pieces', `${buried.length} ribbon tiles with a piece on them: ${some(buried.map(i => say(P, i)))}`);
  const bs = bodies(G.adj, sq);
  if (bs.length > 1) fail('ribbon', where, 'one body', `the ribbon alone is ${bs.length} bodies (sizes ${bs.map(b => b.length).sort((a, b) => b - a).join(', ')}): ${some(bs.sort((a, b) => a.length - b.length).slice(0, -1).flat().map(i => say(P, i)), 3)}`);
}

function frameCheck(m: SqModel, G: Geom, scale: Scale, where: string, studs: boolean) {
  const P = m.pieces, [W, H] = PANEL[scale], OW = W + 4, OH = H + 4;
  const back = ids(P, p => p.y === 0 && p.kind === 'plate'), bp = back.map(i => P[i]), bb = box(bp);
  if (bb.x1 - bb.x0 !== OW || bb.z1 - bb.z0 !== OH || area(bp) !== OW * OH || bp.some(p => p.c !== BLACK || p.role !== 'display'))
    fail('display', where, 'backing', `backing plates ${bb.x1 - bb.x0}×${bb.z1 - bb.z0} (${area(bp)} studs), expected ${OW}×${OH} black`);
  const px0 = bb.x0 + 2, pz0 = bb.z0 + 2, panel = P.filter(p => p.role === 'display' && p.c === WHITE), pb = box(panel);
  if (!panel.length || panel.some(p => p.kind !== 'plate' || p.y !== 1) || pb.x0 !== px0 || pb.z0 !== pz0 || pb.x1 - pb.x0 !== W || pb.z1 - pb.z0 !== H || area(panel) !== W * H)
    fail('display', where, 'panel size', `white panel ${pb.x1 - pb.x0}×${pb.z1 - pb.z0} at ${pb.x0 - bb.x0},${pb.z0 - bb.z0} (${area(panel)} studs), expected ${W}×${H} plates at 2,2 on y 1`);
  const s1 = openSeams(bp, P.filter(p => p.y === 1)), s2 = openSeams(panel, P.filter(p => p.y === 0));
  if (s1.open.length || s2.open.length) fail('display', where, 'joints staggered', `${s1.open.length} backing seams, ${s2.open.length} panel seams crossed along less than half: ${some([...s1.open, ...s2.open])}`);
  // the ring: black Technic bricks on y 1–3 and black tiles on y 4 over every cell; one body without the backing
  const inPanel = (x: number, z: number) => x >= px0 && z >= pz0 && x < px0 + W && z < pz0 + H, holes: string[] = [], ring = new Set<number>();
  for (let x = bb.x0; x < bb.x0 + OW; x++) for (let z = bb.z0; z < bb.z0 + OH; z++) if (!inPanel(x, z)) for (let y = 1; y <= 4; y++) {
    const i = G.at(K(x, z), y), p = i === undefined ? null : P[i];
    const ok = !!p && p.c === BLACK && p.role === 'display' && (y < 4 ? p.kind === 'technic' && p.y === 1 && p.h === 3 : p.kind === 'tile' && p.y === 4);
    if (ok) ring.add(i!); else holes.push(`${x - bb.x0},${z - bb.z0},y${y}${p ? ` ${p.kind} ${cname(p.c)}` : ' empty'}`);
  }
  if (holes.length) fail('display', where, 'frame closed', `${holes.length} ring cells not a black Technic brick (y 1–3) or black tile (y 4): ${some(holes)}`);
  const rb = bodies(G.adj, [...ring]), narrow = [...ring].filter(i => P[i].y === 4 && Math.min(P[i].w, P[i].d) < 2);
  if (rb.length > 1) fail('display', where, 'frame closed', `the frame (Technic rows + cap) is ${rb.length} bodies on its own`);
  if (narrow.length) fail('display', where, 'frame cap', `${narrow.length} cap tiles 1 stud wide: they do not tie both Technic rows: ${some(narrow.map(i => say(P, i)))}`);
  // the ribbon on the panel
  const sq = ids(P, p => p.role === 'squiggle'), r = box(sq.map(i => P[i]));
  if (r.y0 !== 2) fail('display', where, 'ribbon height', `ribbon bottom at y ${r.y0}, expected 2 (on the panel)`);
  const mg = [r.x0 - px0, px0 + W - r.x1, r.z0 - pz0, pz0 + H - r.z1];
  if (mg[0] < 4 || mg[1] < 4 || mg[2] < 1 || mg[3] < 1) fail('ribbon', where, 'margins', `ribbon to panel edge: left ${mg[0]}, right ${mg[1]}, bottom ${mg[2]}, top ${mg[3]} (≥ 4, 4, 1, 1)`);
  if (Math.abs(mg[0] - mg[1]) > 2 || Math.abs(mg[2] - mg[3]) > 2) fail('ribbon', where, 'centred', `ribbon not centred on the panel: left ${mg[0]}, right ${mg[1]}, bottom ${mg[2]}, top ${mg[3]}`);
  const two = sq.filter(i => G.studs[i] < 2);
  // the panel's fault only for a piece of ≥ 2 studs on the panel level missing studs under it
  if (two.length) fail(two.every(i => P[i].w * P[i].d >= 2 && P[i].y === r.y0) ? 'display' : 'ribbon', where, 'two studs', `${two.length} ribbon pieces held by < 2 studs from below: ${some(two.map(i => `${say(P, i)}: ${G.studs[i]}`), 4)}`);
  if (m.checks.twoStud !== two.length) fail('display', where, 'reported twoStud', `builder reports ${m.checks.twoStud}, recount ${two.length}`);
  if (m.checks.comInside !== null || m.pose !== 'wall') fail('display', where, 'model', `comInside ${m.checks.comInside} (want null), pose ${m.pose} (want wall)`);
  // back: 4 black Technic 1×2 (3700) under the backing, long side along z (holes along x); the top two hang it
  const hb = ids(P, p => p.y < 0), mid = bb.z0 + OH / 2;
  const shape = hb.every(i => { const p = P[i]; return p.kind === 'technic' && p.part === '3700' && p.c === BLACK && p.w === 1 && p.d === 2 && p.y === -3 && p.role === 'display'; });
  const topH = hb.filter(i => P[i].z + 1 > mid), botH = hb.filter(i => P[i].z + 1 < mid);
  const corner = (i: number) => Math.min(P[i].x - bb.x0, bb.x1 - 1 - P[i].x) <= 4 && Math.min(P[i].z - bb.z0, bb.z1 - 2 - P[i].z) <= 4;
  const held = hb.every(i => [...G.above[i].keys()].some(j => back.includes(j)));
  const sides = (hs: number[]) => hs.length === 2 && new Set(hs.map(i => P[i].x < bb.x0 + OW / 2)).size === 2;
  if (hb.length !== 4 || !shape || !sides(topH) || !sides(botH) || !hb.every(corner) || !held)
    fail('display', where, 'hanging bricks', `${hb.length} pieces under the backing (${topH.length} top, ${botH.length} bottom), shape ${shape ? 'ok' : 'wrong'}, ${held ? 'on' : 'not all on'} the backing: ${some(hb.map(i => say(P, i)))}`);
  const pts = m.hanging?.points ?? [];
  if (!m.hanging || pts.length !== 2 || !pts.every(i => topH.includes(i)) || pts[0] === pts[1]) fail('display', where, 'hanging points', `hanging.points ${JSON.stringify(pts)}, the top bricks are ${JSON.stringify(topH)}`);
  if (m.hanging) {
    const g = m.grams, a = m.hanging.advice, want = g < 1000 ? /one picture hook/ : g < 3000 ? /two picture hooks|screw with a wall plug/ : /two screws/;
    if (!want.test(a)) fail('display', where, 'hanging advice', `${g} g: "${a}"`);
  }
  const np = m.nameplate ? P[m.nameplate.piece] : null;
  if (np && (np.y !== 4 || np.z !== bb.z0 || np.x < bb.x0 + OW / 2 || np.x + np.w > bb.x1)) fail('display', where, 'nameplate place', `nameplate at x${np.x - bb.x0} z${np.z - bb.z0} y${np.y}, expected on the bottom-right of the frame cap (z 0, y 4)`);
  ribbonCheck(m, G, where, studs);
}

/** arc positions of the supports along the line: on every pass within R of the support's cell centre, the nearest point */
function along(line: Pt[], cells: number[], R: number) {
  const at: number[] = [];
  for (const c of cells) {
    const cx = KX(c) + 0.5, cz = KZ(c) + 0.5;
    let best = Infinity, bs = 0, run = false;
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
      const t = l2 ? Math.max(0, Math.min(1, ((cx - a.x) * vx + (cz - a.z) * vz) / l2)) : 0, d = Math.hypot(a.x + t * vx - cx, a.z + t * vz - cz);
      if (d <= R) { if (d < best) { best = d; bs = a.s + t * (b.s - a.s); } run = true; } else if (run) { at.push(bs); best = Infinity; run = false; }
    }
    if (run) at.push(bs);
  }
  return at.sort((p, q) => p - q);
}
/** gaps over 8 studs; each tip with a support within 2 studs of it along the line or in space (a jittery line's
 *  arc runs ahead of the distance covered) */
const spacing = (at: number[], line: Pt[], cells: number[]) => {
  const total = line[line.length - 1].s, near = (p: Pt) => cells.some(c => Math.hypot(KX(c) + 0.5 - p.x, KZ(c) + 0.5 - p.z) <= TIP);
  return {
    gaps: at.slice(1).map((s, i) => [at[i], s]).filter(([a, b]) => b - a > GAP + 1e-6),
    ends: at.length > 0 && (at[0] <= TIP + 1e-6 || near(line[0])) && (at[at.length - 1] >= total - TIP - 1e-6 || near(line[line.length - 1])),
  };
};

function standCheck(m: SqModel, G: Geom, backdrop: boolean, where: string, studs: boolean, line: Pt[], width: number) {
  const P = m.pieces, base = ids(P, p => p.y === 0 && p.kind === 'plate'), bp = base.map(i => P[i]), sb = box(bp), SW = sb.x1 - sb.x0, SD = sb.z1 - sb.z0;
  if (!SOCLE_W.includes(SW) || !SOCLE_D.includes(SD) || area(bp) !== SW * SD || bp.some(p => p.c !== BLACK || p.role !== 'display'))
    fail('display', where, 'socle size', `socle plates ${SW}×${SD} (${area(bp)} studs); widths ${SOCLE_W.join('/')}, depths ${SOCLE_D.join('/')}, black`);
  const open: string[] = [];
  for (let x = sb.x0; x < sb.x1; x++) for (let z = sb.z0; z < sb.z1; z++) if (G.at(K(x, z), 1) === undefined) open.push(`${x - sb.x0},${z - sb.z0}`);
  if (open.length) fail('display', where, 'socle top', `${open.length} socle cells with nothing on them at y 1 (bare studs): ${some(open)}`);
  const y1 = P.filter(p => p.y === 1), socleTiles = y1.filter(p => p.kind === 'tile');
  if (socleTiles.some(p => p.c !== BLACK || p.role !== 'display')) fail('display', where, 'socle tiles', 'socle tiles not all black display pieces');
  const sm = openSeams(bp, y1);
  if (sm.open.length) fail('display', where, 'seams bridged', `${sm.open.length} of ${sm.n} socle seams crossed along less than half: ${some(sm.open)}`);

  const sq = ids(P, p => p.role === 'squiggle'), rb = box(sq.map(i => P[i])), bw = rb.x1 - rb.x0, bd = rb.z1 - rb.z0;
  if (rb.y0 !== 8) fail('display', where, 'lift', `ribbon bottom at y ${rb.y0}, expected 8 (6 plates over the socle top at y 2)`);
  const mg = { left: rb.x0 - sb.x0, right: sb.x1 - rb.x1, front: rb.z0 - sb.z0, back: sb.z1 - rb.z1 };
  if (mg.left < 4 || mg.right < 4 || mg.front < 3 || (!backdrop && mg.back < 3)) fail('display', where, 'margins', `socle margins left ${mg.left}, right ${mg.right}, front ${mg.front}, back ${mg.back} (≥ 4, 4, 3${backdrop ? '' : ', 3'})`);

  // supports: Trans-Clear columns, round plate 6141 + 2 round bricks 3062b, from a socle plate (y 1) up to a ribbon piece at y 8
  const supIds = ids(P, p => !!p.support || p.c === TRANS_CLEAR), cols = new Map<number, number[]>();
  for (const i of supIds) { const c = K(P[i].x, P[i].z); if (!cols.has(c)) cols.set(c, []); cols.get(c)!.push(i); }
  const badCol: string[] = [];
  for (const [c, cs] of cols) {
    const col = cs.map(i => P[i]).sort((a, b) => a.y - b.y), sig2 = col.map(p => `${p.part}@${p.y}`).join(' ');
    const clear = col.every(p => p.kind === 'round' && p.w === 1 && p.d === 1 && p.c === TRANS_CLEAR && p.support && p.role === 'display');
    const onPlate = base.includes(G.at(c, 0) ?? -1), up = G.at(c, 8), under = up !== undefined && P[up].role === 'squiggle' && P[up].y === 8;
    if (!clear || sig2 !== '6141@1 3062b@2 3062b@5' || !onPlate || !under)
      badCol.push(`${KX(c) - sb.x0},${KZ(c) - sb.z0}: ${sig2}${clear ? '' : ', not all Trans-Clear round support pieces'}${onPlate ? '' : ', not on a socle plate'}${under ? '' : ', no ribbon bottom-layer piece on top'}`);
  }
  if (!cols.size || badCol.length) fail('display', where, 'supports', `${cols.size} columns, ${badCol.length} wrong: ${some(badCol)}`);
  // spacing along the centre line: a support counts on every pass whose stroke its cell touches (within width/2 + ½)
  const total = line[line.length - 1].s, cells = [...cols.keys()], fmt = (g: number[][]) => some(g.map(([a, b]) => `s ${a.toFixed(1)}–${b.toFixed(1)} (${(b - a).toFixed(1)})`));
  const at = along(line, cells, width / 2 + 0.5), sp = spacing(at, line, cells);
  if (sp.gaps.length) fail('display', where, 'support spacing', `${sp.gaps.length} gaps > ${GAP} studs between consecutive supports along the centre line (${cols.size} supports, line ${total.toFixed(1)} studs): ${fmt(sp.gaps)}`);
  if (!sp.ends) fail('display', where, 'ends supported', `first support at s ${at[0]?.toFixed(1)}, last at s ${at[at.length - 1]?.toFixed(1)} of ${total.toFixed(1)}, none within ${TIP} studs of a tip in space either`);
  const lone = cells.filter(c => !along(line, [c], width / 2 + 0.5).length);
  if (lone.length) note('Supports off the stroke (no pass within width/2 + ½)', `${where}: ${lone.length}`);
  const supStep = m.steps.findIndex(s => s.some(i => supIds.includes(i)));
  if (supStep < 0 || !/^Hidden supports/.test(m.stepNotes[supStep] ?? '')) fail('display', where, 'hidden supports note', `step ${supStep + 1} note: "${m.stepNotes[supStep] ?? ''}"`);

  // centre of mass (part weights) strictly inside the socle
  let g = 0, gx = 0, gz = 0;
  for (const p of P) { const w = partGrams(p.part, p.kind, p.w, p.d, p.h); g += w; gx += w * (p.x + p.w / 2); gz += w * (p.z + p.d / 2); }
  const cx = gx / g, cz = gz / g, inside = cx > sb.x0 && cx < sb.x1 && cz > sb.z0 && cz < sb.z1;
  if (!inside) fail('display', where, 'centre of mass', `COM at x ${(cx - sb.x0).toFixed(2)}, z ${(cz - sb.z0).toFixed(2)}, outside the ${SW}×${SD} socle`);
  if (m.checks.comInside !== inside) fail('display', where, 'reported comInside', `builder reports ${m.checks.comInside}, recount ${inside}`);
  if (m.hanging !== null || m.checks.twoStud !== null || m.pose !== 'table') fail('display', where, 'model', `hanging ${!!m.hanging}, twoStud ${m.checks.twoStud}, pose ${m.pose}`);
  const np = m.nameplate ? P[m.nameplate.piece] : null;
  if (np && (np.y !== 1 || Math.abs(np.x + np.w / 2 - (sb.x0 + SW / 2)) > 0.5 || np.z < sb.z0 || np.z + np.d > rb.z0 || !base.includes(G.at(K(np.x, np.z), 0) ?? -1)))
    fail('display', where, 'nameplate place', `nameplate at x${np.x - sb.x0} z${np.z - sb.z0} y${np.y}; expected on the socle plates, centred (x ${(SW - np.w) / 2}), in the front margin (z + ${np.d} ≤ ${rb.z0 - sb.z0})`);

  let braceDepth = 0;
  if (backdrop) {
    const wall = ids(P, p => p.role === 'display' && p.c === WHITE), wp = wall.map(i => P[i]), wz = Math.min(...wp.map(p => p.z)), bricks = wp.filter(p => p.kind === 'brick');
    if (wz - rb.z1 !== 2) fail('display', where, 'wall gap', `wall face ${wz - rb.z1} studs behind the ribbon's back edge (want 2)`);
    const face: string[] = [];
    for (let x = sb.x0; x < sb.x1; x++) for (let y = 1; y <= 60; y++) { const i = G.at(K(x, wz), y); if (i === undefined || P[i].c !== WHITE || P[i].kind !== 'brick') face.push(`x${x - sb.x0} y${y}${i === undefined ? '' : ` ${P[i].kind} ${cname(P[i].c)}`}`); }
    const top = Math.max(...bricks.map(p => p.y + p.h)), notOn: number[] = [];
    for (let x = sb.x0; x < sb.x1; x++) { const w1 = G.at(K(x, wz), 1); if (!base.includes(G.at(K(x, wz), 0) ?? -1) || w1 === undefined || P[w1].kind !== 'brick') notOn.push(x - sb.x0); }
    if (face.length || top !== 61 || bricks.some(p => p.y < 1 || (p.y - 1) % 3 || p.x < sb.x0 || p.x + p.w > sb.x1) || notOn.length)
      fail('display', where, 'wall', `white brick face ${SW}×60 plates from y 1: ${face.length} cells missing (${some(face, 3)}), bricks up to y ${top} (want 61), ${notOn.length} face cells not a brick straight on a socle plate`);
    const extra = wp.filter(p => p.kind !== 'brick'), capOk = extra.every(p => p.kind === 'tile' && p.y === 61 && p.z === wz);
    if (!capOk) fail('display', where, 'wall', `white display pieces that are neither wall bricks nor a cap on top: ${some(extra.filter(p => !(p.kind === 'tile' && p.y === 61)).map(p => `${p.kind} ${p.w}×${p.d} y${p.y}`))}`);
    else if (extra.length) note('Backdrop wall cap (the brief: 60 plates; with the tile cap the wall stands 61)', `${where}: ${extra.length} white tiles at y 61`);
    let bond = 0;
    const joints = (y: number) => { const s = new Set<number>(); for (const p of bricks) if (p.y === y && p.z <= wz && p.z + p.d > wz) { s.add(p.x); s.add(p.x + p.w); } s.delete(sb.x0); s.delete(sb.x1); return s; };
    for (let y = 4; y < 61; y += 3) { const a = joints(y - 3); for (const j of joints(y)) if (a.has(j)) bond++; }
    if (bond) fail('display', where, 'running bond', `${bond} wall joints over a joint of the course below`);
    const br = ids(P, p => p.role === 'display' && p.c === BLACK && p.kind === 'brick');
    const shown = br.filter(i => { const p = P[i]; return p.z <= wz || p.x < sb.x0 || p.x + p.w > sb.x1 || p.y + p.h > 61 || p.z + p.d > sb.z1; });
    if (!br.length || shown.length) fail('display', where, 'braces hidden', `${br.length} brace bricks, ${shown.length} at or in front of the wall face, beside it, above it or off the socle: ${some(shown.map(i => say(P, i)))}`);
    const ties = wall.filter(i => P[i].kind === 'brick' && P[i].z === wz && P[i].d >= 2), groups = bodies(G.adj, [...br, ...ties]).filter(gr => gr.some(i => br.includes(i)));
    const tied = groups.filter(gr => gr.some(i => ties.includes(i)));
    if (groups.length !== 2 || tied.length !== 2) fail('display', where, 'braces', `${groups.length} braces, ${tied.length} tied to the wall by a brick spanning the wall row and the brace`);
    braceDepth = br.length ? Math.max(...br.map(i => P[i].z + P[i].d)) - (wz + 1) : 0;
    const lit = Object.entries(m.stepNotes).some(([k, n]) => /Lighting notes/.test(n) && m.steps[+k]?.some(i => wall.includes(i)));
    if (!lit) fail('display', where, 'lighting notes', 'no "Lighting notes" on a wall step');
    const electric = m.bom.filter(l => /LED|light|batter/i.test(l.name));
    if (electric.length) fail('display', where, 'lighting notes', `electrical parts in the list: ${electric.map(l => l.name).join(', ')}`);
  } else if (P.some(p => p.kind === 'brick' || (p.role === 'display' && p.c === WHITE))) fail('display', where, 'floating', 'bricks or white display pieces on a Floating display');
  // socle size: the smallest that leaves the margins (Backdrop: front 3 + ribbon + gap 2 + wall 1 + braces)
  const wantW = SOCLE_W.find(w => w >= bw + 8), wantD = SOCLE_D.find(d => d >= bd + (backdrop ? 3 + 2 + 1 + braceDepth : 6));
  if (wantW === undefined || wantD === undefined) fail('display', where, 'socle size', `the ${bw}×${bd} ribbon fits no socle with its margins`);
  else if (SW !== wantW || SD !== wantD) fail('display', where, 'socle size', `${SW}×${SD}, the smallest that fits the ${bw}×${bd} ribbon is ${wantW}×${wantD}`);
  ribbonCheck(m, G, where, studs);
}

/** the centre line placement: a uniform scale of the curve, y flipped, inside the brief's fit */
function lineCheck(rb: Ribbon, curve: Curve, scale: Scale, where: string) {
  const { x0, y1, x1, y0 } = curve.box, arc = arcLength(curve.points), [W, H] = PANEL[scale], w = WIDTH[curve.type];
  const bad = rb.line.length !== curve.points.length || curve.points.some((p, i) => {
    const q = rb.line[i];
    return Math.abs(q.x - (rb.offset.x + (p.x - x0) * rb.k)) > 1e-6 || Math.abs(q.z - (rb.offset.z + (y1 - p.y) * rb.k)) > 1e-6 || Math.abs(q.s - arc[i] * rb.k) > 1e-6;
  });
  if (bad) fail('ribbon', where, 'centre line', 'Ribbon.line is not the curve scaled by k from offset (x right, image y up)');
  if (rb.width !== w) fail('ribbon', where, 'width', `ribbon width ${rb.width}, the brief says ${w} for ${curve.type}`);
  const lim = Math.min((W - 8 - w) / Math.max(x1 - x0, 1), (H - 2 - w) / Math.max(y1 - y0, 1), scale === 'small' ? 3 / (curve.canvas.h / 13) : Infinity);
  if (rb.k > lim + 1e-9) fail('ribbon', where, 'fit', `k ${rb.k.toFixed(5)} over the largest that fits the margins, ${lim.toFixed(5)}`);
  else if (rb.k < lim - 1e-9) note('Ribbon drawn smaller than the largest fit', `${where}: ${((1 - rb.k / lim) * 100).toFixed(1)}%`);
}

function relief(src: Src, scale: Scale, studs: boolean) {
  const meta = { id: src.id, hash: src.hash }, look = studs ? ' studs' : '', tag = (d: string) => `#${src.id} ${d}${look} ${scale}`, curve = readCurve(src);
  let t = now();
  const rb = buildRibbon(readCurve(src), scale, { studs }), msR = now() - t;
  lineCheck(rb, curve, scale, tag('ribbon'));
  const models = new Map<Display, SqModel>(), ms = new Map<Display, number>();
  for (const d of DISPLAYS) {
    try {
      const times: number[] = [];
      for (let n = 0; n < 3; n++) {   // a fresh curve each time (the builder caches the ribbon per curve); up to 3 tries when slow
        t = now();
        const m = buildRelief(readCurve(src), d, scale, meta, { studs });
        times.push(now() - t);
        if (!n) models.set(d, m);
        if (times[n] <= LIMIT_MS) break;
      }
      ms.set(d, Math.min(...times));
    } catch (e) { fail('display', tag(d), 'build', `throws: ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`); }
  }
  if (msR > LIMIT_MS) {
    t = now(); buildRibbon(readCurve(src), scale, { studs });
    const again = now() - t;
    if (again > LIMIT_MS) fail('ribbon', tag('ribbon'), 'time', `buildRibbon ${Math.min(msR, again).toFixed(0)} ms (> ${LIMIT_MS})`);
  }
  // one ribbon: the same pieces (relative positions, colours, parts) in buildRibbon and in the three displays
  const own = sig(rb.pieces), sigs = new Map<Display, string>();
  for (const [d, m] of models) sigs.set(d, sig(m.pieces.filter(p => p.role === 'squiggle')));
  const odd = [...sigs].filter(([, s]) => s !== own);
  if (odd.length) {
    const twice = sig(buildRibbon(readCurve(src), scale, { studs }).pieces) === own;
    for (const [d, s] of odd) fail(twice ? 'display' : 'ribbon', tag(d), 'same ribbon', `its ribbon pieces differ from buildRibbon's (${s.split('|').length} vs ${rb.pieces.length} pieces)${twice ? '' : '; buildRibbon itself gives another ribbon on a second call'}`);
  }
  // colour order along the centre line, on the ribbon's top colours
  const rt = new Map<number, Piece>();
  for (const p of rb.pieces) for (const c of foot(p)) { const q = rt.get(c); if (!q || q.y < p.y) rt.set(c, p); }
  const walk = colourWalk(rb.line, [curveColors(curve, 2 / rb.k), rb.colors], c => rt.get(c)?.c, rb.width / 2, 2 * rb.width, false);
  if (walk.skips.length) fail('ribbon', tag('ribbon'), 'colour order', `${walk.skips.length} spectrum skips along the centre line, top colours (${walk.read} cells read): ${some(walk.skips, 4)}`);
  if (walk.trimmed) note('Centre-line cells with no ribbon piece (trimmed)', `${tag('ribbon')}: ${walk.trimmed}`);
  if (walk.off) note('Centre-line cells more than 1 step from their own line colour (no skip)', `${tag('ribbon')}: ${walk.off}`);
  if (walk.under) note('Centre-line cells of the latest pass showing an earlier pass\'s colour', `${tag('ribbon')}: ${walk.under}`);
  // footprint against the stroke: cells well inside it (centre within width/2 − ½ of the line) missing, cells over 1 stud outside it
  const inner = new Set<number>(), near = new Set<number>();
  for (const q of dense(rb.line)) { disc(q.x, q.z, rb.width / 2 - 0.5, c => inner.add(c)); disc(q.x, q.z, rb.width / 2 + 1, c => near.add(c)); }
  const lack = [...inner].filter(c => !rt.has(c)), extra = [...rt.keys()].filter(c => !near.has(c));
  if (lack.length) note('Stroke cells missing from the ribbon (centre within width/2 − ½ of the line)', `${tag('ribbon')}: ${lack.length} (${some(lack.map(c => `${KX(c)},${KZ(c)}`), 4)})`);
  if (extra.length) note('Ribbon cells over 1 stud outside the stroke (filled holes)', `${tag('ribbon')}: ${extra.length}`);

  const rb0 = box(rb.pieces);
  for (const [d, m] of models) {
    const where = tag(d), P = m.pieces, G = geom(P), roots = ids(P, p => p.y === 0 && p.kind === 'plate' && p.c === BLACK);
    if (m.format !== 'relief' || m.display !== d || m.scale !== scale) fail('display', where, 'model', `format ${m.format}, display ${m.display}, scale ${m.scale}`);
    const { floating } = common(m, G, where, 'display', roots, src, i => (P[i].role === 'squiggle' ? 'ribbon' : 'display'));
    const mb = box(P.filter(p => p.role === 'squiggle')), line = rb.line.map(p => ({ x: p.x + mb.x0 - rb0.x0, z: p.z + mb.z0 - rb0.z0, s: p.s }));
    const ys = m.steps.filter(st => st.some(i => P[i]?.role === 'squiggle')).map(st => [...new Set(st.map(i => P[i]?.y))]);
    if (ys.some(y => y.length > 1) || ys.some((y, k) => k && y[0] < ys[k - 1][0])) fail('display', where, 'ribbon steps', `ribbon steps not one layer each, bottom to top: ${some(ys.map(y => y.join('+')), 12)}`);
    if (d === 'frame') {
      frameCheck(m, G, scale, where, studs);
      const bb = box(P.filter(p => p.y === 0 && p.kind === 'plate'));
      if (mb.x0 - rb0.x0 !== bb.x0 + 2 || mb.z0 - rb0.z0 !== bb.z0 + 2) fail('display', where, 'ribbon place', `ribbon moved by ${mb.x0 - rb0.x0},${mb.z0 - rb0.z0}, the panel corner is at ${bb.x0 + 2},${bb.z0 + 2}: not buildRibbon's fit on the panel`);
    } else standCheck(m, G, d === 'backdrop', where, studs, line, rb.width);
    const took = ms.get(d)!;
    if (took > LIMIT_MS) fail(msR > LIMIT_MS ? 'ribbon' : 'display', where, 'time', `buildRelief ${took.toFixed(0)} ms cold, best of 3 (> ${LIMIT_MS}); buildRibbon alone ${msR.toFixed(0)} ms`);
    rows.push({ where, pieces: P.length, floating, collisions: G.clashes.length, ms: took, grams: m.grams });
  }
  rows.push({ where: tag('ribbon'), pieces: rb.pieces.length, floating: 0, collisions: 0, ms: msR, grams: 0 });
}

// ---- run ----
function main() {
  const t0 = now();
  { const w = JSON.parse(readFileSync(`${DIR}/${IDS[0]}.json`, 'utf8')) as Src; try { buildMosaic(readCurve(w), 'small', w); buildRelief(readCurve(w), 'frame', 'small', w); } catch { /* reported below */ } }
  for (const id of IDS) {
    const src = JSON.parse(readFileSync(`${DIR}/${id}.json`, 'utf8')) as Src;
    for (const scale of ['small', 'large'] as const) {
      const where = `#${id} mosaic ${scale}`;
      try {
        let m: SqModel | null = null, took = Infinity;
        for (let n = 0; n < 3 && took > LIMIT_MS; n++) { const t = now(), r = buildMosaic(readCurve(src), scale, { id: src.id, hash: src.hash }); took = Math.min(took, now() - t); m ??= r; }
        const c = mosaicCheck(m!, readCurve(src), scale, where, src);
        if (took > LIMIT_MS) fail('mosaic', where, 'time', `buildMosaic ${took.toFixed(0)} ms, best of 3 (> ${LIMIT_MS})`);
        rows.push({ where, pieces: m!.pieces.length, ...c, ms: took, grams: m!.grams });
      } catch (e) { fail('mosaic', where, 'build', `throws: ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`); }
      for (const studs of LOOKS) {
        try { relief(src, scale, studs); } catch (e) { fail('display', `#${id} relief${studs ? ' studs' : ''} ${scale}`, 'build', `throws: ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`); }
      }
    }
    process.stderr.write(`#${id} ${String(readCurve(src).type)} done\n`);
  }
  console.log('model                                   pieces floating collisions     grams       ms');
  for (const r of rows) console.log(`${r.where.padEnd(38)} ${String(r.pieces).padStart(7)} ${String(r.floating).padStart(8)} ${String(r.collisions).padStart(10)} ${String(r.grams).padStart(9)} ${r.ms.toFixed(0).padStart(8)}`);
  const slow = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(`\n${rows.length} builds in ${((now() - t0) / 1000).toFixed(0)} s; slowest: ${slow.map(r => `${r.where} ${r.ms.toFixed(0)} ms`).join(', ')}`);
  if (info.size) {
    console.log('\nNotes (not failures):');
    for (const [k, v] of info) console.log(`  ${k}: ${v.length} model${v.length > 1 ? 's' : ''} — ${some(v, 6)}`);
  }
  const by = new Map<string, number>();
  for (const f of fails) by.set(`[${f.owner}] ${f.check}`, (by.get(`[${f.owner}] ${f.check}`) ?? 0) + 1);
  console.log(`\n${fails.length} failures${fails.length ? ':' : ''}`);
  for (const [k, n] of [...by].sort()) console.log(`  ${k}: ${n}`);
  for (const f of fails) console.log(`[${f.owner}] ${f.where} — ${f.check}: ${f.detail}`);
  if (ji >= 0 && argv[ji + 1]) writeFileSync(argv[ji + 1], JSON.stringify({ fails, info: Object.fromEntries(info), rows }, null, 1));
  process.exitCode = fails.length ? 1 : 0;
}
main();
