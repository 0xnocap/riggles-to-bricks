import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderHex } from '../src/core/palette';
import { PARTS, type Kind } from '../src/core/parts';
import { bookletPlan, closeUp, ghost, hooksFor, insetRoom, INV, inventoryPages, layerCaption, modelTitle, NUM_SIZE, PAGE_MM, PAGE_PX, partIcon, PLAN, planAspect, planFit, PRINT, raisedRibbon, shortName, splitNote, SqPageMaker, stepLayout, stepNote, stepParts, stepPlan, wallFace, zoomFocus } from '../src/squiggle/booklet';
import { readCurve } from '../src/squiggle/curve';
import { buildRelief } from '../src/squiggle/display';
import type { SqModel } from '../src/squiggle/model';
import { buildMosaic } from '../src/squiggle/mosaic';
import { NAMEPLATE_MM } from '../src/squiggle/nameplate';
import { SPECTRUM, WHITE, BLACK } from '../src/squiggle/spectrum';

const fixture = (id: number) => JSON.parse(readFileSync(`test/fixtures/squiggles/${id}.json`, 'utf8'));
const MODES = ['frame', 'floating', 'backdrop', 'mosaic'] as const;
const cache = new Map<string, SqModel>();
function model(id: number, mode: typeof MODES[number], scale: 'small' | 'large' = 'large'): SqModel {
  const k = `${id}${mode}${scale}`;
  if (!cache.has(k)) {
    const f = fixture(id), c = readCurve(f), meta = { id: f.id, hash: f.hash };
    cache.set(k, mode === 'mosaic' ? buildMosaic(c, scale, meta) : buildRelief(c, mode, scale, meta));
  }
  return cache.get(k)!;
}
const CASES = [1234, 102, 1047].flatMap(id => MODES.map(mode => [id, mode] as const));
const RANK = [...SPECTRUM.map(s => s.id), WHITE, BLACK, 12];

describe('booklet plan', () => {
  for (const [id, mode] of CASES) it(`#${id} ${mode}: cover, parts, every step, nameplate, hanging (Frame), finished`, () => {
    const m = model(id, mode), plan = bookletPlan(m), kinds = plan.map(p => p.kind);
    expect(kinds[0]).toBe('cover');
    expect(kinds.at(-1)).toBe('end');
    const parts = plan.filter(p => p.kind === 'parts'), steps = plan.filter(p => p.kind === 'step');
    expect(parts.length).toBe(inventoryPages(m).length);
    expect(steps.map(p => p.label)).toEqual(m.steps.map((_, i) => `Step ${i + 1}`));
    expect(kinds.filter(k => k === 'nameplate').length).toBe(m.nameplate ? 1 : 0);
    expect(kinds.includes('hanging')).toBe(mode === 'frame');
    // a raised ribbon (Floating, Backdrop) is placed on its supports right after its last step on the table
    const rr = raisedRibbon(m), place = plan.findIndex(p => p.kind === 'place');
    expect(!!rr).toBe(mode === 'floating' || mode === 'backdrop');
    expect(kinds.filter(k => k === 'place').length).toBe(rr ? 1 : 0);
    if (rr) {
      expect(plan[place - 1]).toMatchObject({ kind: 'step', index: rr.steps.at(-1) });
      expect(rr.steps).toEqual(m.steps.map((_, i) => i).filter(i => m.steps[i].every(j => m.pieces[j].role === 'squiggle')));
      expect(rr.steps.flatMap(i => m.steps[i]).sort((a, b) => a - b)).toEqual(rr.ids);
    }
    // in order: cover, parts, steps (and the placing), nameplate, hanging, end
    const order = ['cover', 'parts', 'step', 'nameplate', 'hanging', 'end'], rank = (k: string) => order.indexOf(k === 'place' ? 'step' : k);
    expect(kinds.map(rank)).toEqual([...kinds.map(rank)].sort((a, b) => a - b));
    expect(parts.map(p => p.label)).toEqual(parts.length > 1 ? parts.map((_, i) => `Parts ${i + 1}/${parts.length}`) : ['Parts']);
  });
});

describe('parts inventory', () => {
  for (const [id, mode] of CASES) it(`#${id} ${mode}: every lot once, Squiggle then Display, headed, fits the page`, () => {
    const m = model(id, mode), pages = inventoryPages(m);
    const seen = pages.flat().flatMap(r => ('lines' in r ? r.lines : []));
    expect(seen.length).toBe(m.bom.length);
    expect(new Set(seen).size).toBe(m.bom.length);
    expect(seen.reduce((a, l) => a + l.qty, 0)).toBe(m.pieces.length);
    const roles = seen.map(l => l.role);
    expect(roles).toEqual([...roles].sort((a, b) => (a === b ? 0 : a === 'squiggle' ? -1 : 1)));
    for (const page of pages) {
      expect(page.length).toBeGreaterThan(0);
      expect('head' in page[0]).toBe(true);            // a page starts with its section's head
      let y = INV.top, role: string | null = null;
      page.forEach((r, k) => {
        if ('head' in r) { y += (k ? INV.gap : 0) + INV.head; role = r.head; }
        else { expect(r.lines.length).toBeLessThanOrEqual(INV.cols); expect(r.lines.every(l => l.role === role)).toBe(true); y += INV.row; }
      });
      expect(y).toBeLessThanOrEqual(INV.bottom);
    }
    // a section's first head is not "continued", later ones are
    const heads = pages.flat().filter(r => 'head' in r) as { head: string; cont: boolean }[];
    for (const role of ['squiggle', 'display']) {
      const hs = heads.filter(h => h.head === role);
      if (hs.length) expect(hs.map(h => h.cont)).toEqual(hs.map((_, i) => i > 0));
    }
    // within a section, lots go by colour in spectrum order
    for (const role of ['squiggle', 'display']) {
      const r = seen.filter(l => l.role === role).map(l => RANK.indexOf(l.color));
      expect(r).toEqual([...r].sort((a, b) => a - b));
    }
  });
});

describe('step pages', () => {
  for (const [id, mode] of CASES) it(`#${id} ${mode}: each step's parts add up and lay out on the page`, () => {
    const m = model(id, mode);
    m.steps.forEach((ids, si) => {
      const parts = stepParts(m, si);
      expect(parts.reduce((a, p) => a + p.qty, 0)).toBe(ids.length);
      for (const p of parts) expect(p.a).toBeLessThanOrEqual(p.b);
      const r = parts.map(p => RANK.indexOf(p.c));
      expect(r).toEqual([...r].sort((a, b) => a - b));
      for (const noteH of [0, 150]) for (const aspect of [0.8, 1.4, 2.2]) {
        const L = stepLayout(parts.length, String(si + 1).length, noteH, aspect), b = L.box, v = L.view;
        expect(Math.ceil(parts.length / b.cols) * b.rh + 28).toBeLessThanOrEqual(b.h);
        expect(b.cols * b.cw + 28).toBeLessThanOrEqual(b.w);
        const bottom = PAGE_PX[1] - 90 - 20 - (noteH ? noteH + 14 : 0);
        for (const q of [b, v]) { expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x + q.w).toBeLessThanOrEqual(PAGE_PX[0]); expect(q.y + q.h).toBeLessThanOrEqual(bottom); }
        const apart = b.x + b.w <= v.x || v.x + v.w <= b.x || b.y + b.h <= v.y || v.y + v.h <= b.y;
        expect(apart).toBe(true);
        expect(Math.min(v.w, v.h)).toBeGreaterThan(300);
        expect(L.num.y - NUM_SIZE).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('close-ups: one clear support column, one hanging brick, the nameplate; none for big steps', () => {
    const fl = model(1234, 'floating'), sup = fl.steps.findIndex(s => s.every(i => fl.pieces[i].support));
    const col = zoomFocus(fl, sup)!.map(i => fl.pieces[i]);
    expect(col.length).toBe(3);
    expect(new Set(col.map(p => `${p.x},${p.z}`)).size).toBe(1);
    // the Frame's back: a hanging point (the cord goes through it), not a spacer
    const fr = model(1234, 'frame'), hang = fr.steps.findIndex(s => s.every(i => fr.pieces[i].y < 0)), hz = zoomFocus(fr, hang)!;
    expect(hz.map(i => fr.pieces[i].kind)).toEqual(['technic']);
    expect(fr.hanging!.points).toContain(hz[0]);
    for (const m of [fl, fr, model(1234, 'mosaic')]) {
      const last = m.steps.length - 1;
      expect(zoomFocus(m, last)).toEqual([m.nameplate!.piece]);
      expect(zoomFocus(m, 0)).toBeNull();
    }
  });
});

/** A 2D context that keeps the bounds of everything drawn (with its transforms). */
function boundsCtx() {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let t = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const add = (x: number, y: number) => {
    const X = t[0] * x + t[2] * y + t[4], Y = t[1] * x + t[3] * y + t[5];
    b.x0 = Math.min(b.x0, X); b.y0 = Math.min(b.y0, Y); b.x1 = Math.max(b.x1, X); b.y1 = Math.max(b.y1, Y);
  };
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', globalAlpha: 1,
    save() { stack.push(t); }, restore() { t = stack.pop()!; },
    transform(a: number, b2: number, c: number, d: number, e: number, f: number) {
      t = [t[0] * a + t[2] * b2, t[1] * a + t[3] * b2, t[0] * c + t[2] * d, t[1] * c + t[3] * d, t[0] * e + t[2] * f + t[4], t[1] * e + t[3] * f + t[5]];
    },
    beginPath() {}, closePath() {}, fill() {}, stroke() {},
    moveTo: add, lineTo: add,
    rect(x: number, y: number, w: number, h: number) { add(x, y); add(x + w, y + h); },
    arc(x: number, y: number, r: number) { add(x - r, y - r); add(x + r, y + r); },
    ellipse(x: number, y: number, rx: number, ry: number) { add(x - rx, y - ry); add(x + rx, y + ry); },
    createLinearGradient() { return { addColorStop() {} }; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, b };
}

describe('part icons', () => {
  const all = (Object.keys(PARTS) as Kind[]).flatMap(kind => Object.keys(PARTS[kind]).map(k => {
    const [a, b] = k.replace('p', '').split('x').map(Number);
    return { kind, a, b, h: kind === 'plate' || kind === 'tile' || k.endsWith('p') ? 1 : 3 };
  }));
  it('every part, from a 1×1 round plate to a 16×16 plate, draws inside its box', () => {
    expect(all.length).toBeGreaterThan(60);
    for (const p of all) for (const c of [11, 1, 5, 12]) for (const [W, H] of [[80, 70], [52, 46]]) {
      const { ctx, b } = boundsCtx();
      partIcon(ctx, 500, 300, p.kind, p.a, p.b, p.h, c, W, H);
      expect(b.x1 - b.x0, `${p.kind} ${p.a}×${p.b}`).toBeLessThanOrEqual(W + 2);
      expect(b.y1 - b.y0, `${p.kind} ${p.a}×${p.b}`).toBeLessThanOrEqual(H + 2);
      expect(Math.abs((b.x0 + b.x1) / 2 - 500)).toBeLessThan(W * 0.12);
      expect(Math.abs((b.y0 + b.y1) / 2 - 300)).toBeLessThan(H * 0.2);
      expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeGreaterThan(Math.min(W, H) * 0.35);
    }
  });
  it('names parts shortly', () => {
    expect(shortName('technic', 1, 16, 3)).toBe('Technic brick 1×16');
    expect(shortName('round', 1, 1, 1)).toBe('Round plate 1×1');
    expect(shortName('round', 1, 1, 3)).toBe('Round brick 1×1');
    expect(shortName('plate', 16, 16, 1)).toBe('Plate 16×16');
    expect(shortName('tile', 2, 6, 1)).toBe('Tile 2×6');
    // one format everywhere: display · size · studs
    expect(modelTitle(model(1234, 'frame'))).toBe('Frame · Large · 64 × 32 studs');
    expect(modelTitle(model(1234, 'frame', 'small'))).toBe('Frame · Small · 48 × 24 studs');
    expect(modelTitle(model(1234, 'mosaic'))).toBe('Mosaic · 96 × 48 studs');
    expect(modelTitle(model(1234, 'mosaic', 'small'))).toBe('Mosaic · 64 × 32 studs');
    // Floating and Backdrop stand on a socle: its size, not the Frame's panel
    expect(modelTitle(model(1234, 'floating'))).toBe('Floating · Large · 48 × 40 studs');
    expect(modelTitle(model(1234, 'backdrop'))).toMatch(/^Backdrop · Large · \d+ × \d+ studs$/);
  });
});

describe('plans seen from above', () => {
  for (const [id, mode] of CASES) for (const scale of ['large', 'small'] as const) it(`#${id} ${mode} ${scale}: every step but the nameplate drawn flat (from above, the wall from the front), big enough to count studs`, () => {
    const m = model(id, mode, scale), P = m.pieces, rr = raisedRibbon(m), wall = wallFace(m);
    const ribBottom = Math.min(...P.filter(p => p.role === 'squiggle').map(p => p.y));
    expect(!!wall).toBe(mode === 'backdrop');
    m.steps.forEach((ids, si) => {
      const S = ids.map(i => P[i]), plan = stepPlan(m, si), rib = S.every(p => p.role === 'squiggle');
      // which steps: every Mosaic band, every ribbon layer, a raised ribbon's socle plates, tiles and supports, the
      // Frame's backing, panel, back, Technic rows and cap; the Backdrop's wall from the front
      const onWall = !!wall && S.some(p => p.kind === 'brick' && p.c === WHITE);
      const want = S.some(p => p.nameplate) ? false
        : mode === 'mosaic' ? S.every(p => p.kind === 'tile')
        : rib || onWall || (!!rr && (S.every(p => p.support) || S.every(p => p.kind === 'tile' && p.role === 'display' && p.y === 1) || S.every(p => p.kind === 'plate' && p.y === 0))) || mode === 'frame';
      expect(!!plan, `step ${si + 1}`).toBe(want);
      if (!plan) return;
      expect(plan.sub).toBe(!!rr && rib);
      expect(plan.front).toBe(onWall);
      // turned over: only the Frame's back, mirrored (the rulers count from its right edge, on the left as it lies)
      expect(plan.flip).toBe(mode === 'frame' && S.every(p => p.y < 0));
      // a ribbon layer says which one, the wall which courses
      expect(!!plan.caption).toBe((mode !== 'mosaic' && rib) || onWall);
      // the display's pieces carry their size (not the supports, the Frame's back, the ribbon, the Mosaic)
      expect(plan.sizes).toBe(mode !== 'mosaic' && !rib && !plan.flip && !S.every(p => p.support));
      // the area holds the step's pieces (the wall: its width and height, a plate 0.4 stud), the rulers count from inside it
      for (const p of S) {
        expect(p.x).toBeGreaterThanOrEqual(plan.x0); expect(p.x + p.w).toBeLessThanOrEqual(plan.x1);
        if (plan.front) { expect(p.y * 0.4).toBeGreaterThanOrEqual(plan.z0); expect((p.y + p.h) * 0.4).toBeLessThanOrEqual(plan.z1); }
        else { expect(p.z).toBeGreaterThanOrEqual(plan.z0); expect(p.z + p.d).toBeLessThanOrEqual(plan.z1); }
      }
      if (plan.flip) { expect(plan.ox).toBe(plan.x1); } else { expect(plan.ox).toBeGreaterThanOrEqual(plan.x0); expect(plan.ox).toBeLessThan(plan.x1); }
      expect(plan.oz).toBeGreaterThanOrEqual(plan.z0); expect(plan.oz).toBeLessThan(plan.z1);
      if (mode === 'frame' && !plan.flip) {
        // the ribbon counts on the white panel, the frame's own layers from its outer corner
        const panel = P.filter(p => p.kind === 'plate' && p.c === WHITE), all = P.filter(p => p.y >= 0);
        expect([plan.ox, plan.oz]).toEqual(rib ? [Math.min(...panel.map(p => p.x)), Math.min(...panel.map(p => p.z))] : [Math.min(...all.map(p => p.x)), Math.min(...all.map(p => p.z))]);
        expect(plan.ruler).toContain(rib ? 'white panel' : 'frame’s bottom left corner');
      }
      if (mode === 'mosaic') {
        expect(plan.rows![0]).toBe(Math.min(...S.map(p => p.z)) + 1);
        expect(plan.rows![1]).toBe(Math.max(...S.map(p => p.z + p.d)));
      } else if (plan.front) {
        const course = (p: typeof S[number]) => (p.y - wall!.bottom) / 3 + 1, laid = S.filter(p => p.kind === 'brick' && p.c === WHITE && p.z === wall!.z);
        expect(plan.rows).toEqual([Math.min(...laid.map(course)), Math.max(...laid.map(course))]);
        expect(plan.caption).toContain(`Courses ${plan.rows![0]}–${plan.rows![1]} of ${wall!.courses}`);
      } else expect(plan.rows).toBeNull();
      // laid out on the step page: inside the view, a stud at least 10 px wide on a 1600 px page (14 on a Relief)
      // (with a close-up, a column on its right keeps it off the plan, unless it goes over the Frame's empty panel)
      const cu = closeUp(m, si, plan), L = stepLayout(stepParts(m, si).length, String(si + 1).length, stepNote(m, si) ? 110 : 0, planAspect(plan) + (cu && !cu.inside ? 0.5 : 0)), v = L.view;
      const room = cu ? insetRoom(plan, v.w, v.h, cu.context, cu.inside) : { r: 0, side: 0 }, f = planFit(plan, v.w - room.side, v.h);
      if (cu && room.r && !cu.inside) expect(room.side).toBeGreaterThanOrEqual(2 * room.r);
      if (cu?.inside) {
        // over the panel, clear of the frame: the panel is more than the close-up's diameter high
        const panel = P.filter(p => p.kind === 'plate' && p.c === WHITE), H = Math.max(...panel.map(p => p.z + p.d)) - Math.min(...panel.map(p => p.z));
        expect(H * f.s).toBeGreaterThan(2 * room.r + 60);
      }
      expect(f.left).toBeGreaterThanOrEqual(PLAN.left - 0.01); expect(f.top).toBeGreaterThanOrEqual(PLAN.top - 0.01);
      expect(f.left + (plan.x1 - plan.x0) * f.s).toBeLessThanOrEqual(v.w - room.side - PLAN.right + 0.01);
      expect(f.top + (plan.z1 - plan.z0) * f.s).toBeLessThanOrEqual(v.h - PLAN.bottom + 0.01);
      expect(f.s, `step ${si + 1} px per stud`).toBeGreaterThanOrEqual(mode === 'mosaic' ? 10 : 14);
      // a ribbon layer above the first: its pieces in 3D beside the plan, when there is room
      if (rib && mode !== 'mosaic' && S[0].y > ribBottom && !zoomFocus(m, si)) expect(cu).toMatchObject({ ids, context: true, point: false, inside: false });
    });
  });

  it('lays the Backdrop wall course by course, each course on one page, from the front', () => {
    for (const id of [1234, 102]) for (const scale of ['large', 'small'] as const) {
      const m = model(id, 'backdrop', scale), wall = wallFace(m)!, P = m.pieces, seen: number[] = [];
      expect(wall.courses).toBe(20);
      expect(wall.top - wall.bottom).toBe(61);             // 60 plates of bricks and the tile cap
      m.steps.forEach((_, si) => { const p = stepPlan(m, si); if (p?.front) for (let c = p.rows![0]; c <= p.rows![1]; c++) seen.push(c); });
      expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      // what the front view draws: the white bricks of the wall's row (the ties' front ends) and the cap, nothing else
      for (const i of wall.ids) expect(P[i]).toMatchObject({ role: 'display', c: WHITE, z: wall.z });
      expect(wall.ids.filter(i => P[i].kind === 'tile').every(i => P[i].y === wall.top - 1)).toBe(true);
    }
  });

  it('shows in 3D what a flat view cannot: a corner of the Frame, a brace behind the wall', () => {
    for (const scale of ['large', 'small'] as const) {
      const fr = model(1234, 'frame', scale), P = fr.pieces, si = fr.steps.findIndex(s => s.every(i => P[i].kind === 'technic' && P[i].y >= 0));
      const cu = closeUp(fr, si, stepPlan(fr, si))!;
      expect(cu).toMatchObject({ context: true, inside: true, label: 'A corner, in 3D', box: [0, 0, 5, 5] });
      expect(cu.ids.length).toBeGreaterThanOrEqual(3);                       // both rows along the bottom, and the side's
      for (const i of cu.ids) { expect(fr.steps[si]).toContain(i); expect(P[i].x < 5 && P[i].z < 5).toBe(true); }
      const bd = model(1234, 'backdrop', scale), Q = bd.pieces, wi = bd.steps.findIndex(s => s.some(i => Q[i].kind === 'brick' && Q[i].c === BLACK));
      const b = closeUp(bd, wi, stepPlan(bd, wi))!;
      expect(b).toMatchObject({ context: true, inside: false, label: 'A brace, from behind' });
      const xs = new Set(b.behind!.map(i => Q[i].x));
      expect(b.behind!.every(i => Q[i].c === BLACK && Q[i].z > wallFace(bd)!.z)).toBe(true);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4);             // one brace, not both
      expect(b.ids.some(i => Q[i].c === WHITE && Q[i].d === 2)).toBe(true);  // with the ties that hold it
      // the other wall courses and the Frame's other layers need none
      bd.steps.forEach((_, k) => { if (k !== wi && stepPlan(bd, k)?.front) expect(closeUp(bd, k, stepPlan(bd, k))).toBeNull(); });
      fr.steps.forEach((s, k) => { if (k !== si && s.every(i => P[i].y >= 0 && P[i].role === 'display' && !P[i].nameplate)) expect(closeUp(fr, k, stepPlan(fr, k))).toBeNull(); });
    }
  });

  it('adds a note where the Frame drawing needs words, keeps the model’s own', () => {
    for (const scale of ['large', 'small'] as const) {
      const m = model(1234, 'frame', scale), P = m.pieces;
      const tech = m.steps.findIndex(s => s.every(i => P[i].kind === 'technic' && P[i].y >= 0)), panel = m.steps.findIndex(s => s.every(i => P[i].kind === 'plate' && P[i].c === WHITE));
      expect(stepNote(m, tech)).toMatch(/^Two rows of black Technic bricks .*stagger/);
      expect(stepNote(m, panel)).toContain('2 studs in from every edge');
      m.steps.forEach((_, si) => { if (m.stepNotes[si]) expect(stepNote(m, si)).toBe(m.stepNotes[si]); });
    }
    for (const mode of ['floating', 'backdrop', 'mosaic'] as const) { const m = model(1234, mode); m.steps.forEach((_, si) => expect(stepNote(m, si)).toBe(m.stepNotes[si])); }
  });

  it('names each ribbon layer: slab, layer of 3, what it is made of, the way it runs, which part of it', () => {
    for (const mode of ['frame', 'floating'] as const) {
      const m = model(1234, mode), P = m.pieces, rib = P.filter(p => p.role === 'squiggle'), y0 = Math.min(...rib.map(p => p.y));
      const slabs = Math.ceil((Math.max(...rib.map(p => p.y + p.h)) - y0) / 3), seen = new Set<string>();
      m.steps.forEach((ids, si) => {
        const S = ids.map(i => P[i]), cap = layerCaption(m, si);
        if (!S.every(p => p.role === 'squiggle')) { expect(cap).toBeNull(); return; }
        const l = S[0].y - y0, want = slabs > 1 ? `Slab ${Math.floor(l / 3) + 1} of ${slabs} · layer ${(l % 3) + 1} of 3` : `Layer ${l + 1} of 3`;
        expect(cap!.startsWith(`${want} · `), cap!).toBe(true);
        expect(cap).toContain(S.every(p => p.kind === 'tile') ? '· tiles' : S.some(p => p.kind === 'tile') ? '· tiles, plates under the next slab' : '· plates');
        if (l % 3 < 2) expect(S.some(p => p.kind === 'tile')).toBe(false);
        seen.add(want);
      });
      expect(seen.size).toBe(slabs * 3);
    }
    expect(layerCaption(model(1234, 'mosaic'), 1)).toBeNull();
    // the layers above the first run crosswise to the one under them, most of the time
    const m = model(1234, 'frame'), caps = m.steps.map((_, si) => layerCaption(m, si)).filter(c => c && !c.includes('Slab 1 of 2 · layer 1 '));
    expect(caps.filter(c => c!.includes('crosswise to the layer below')).length).toBeGreaterThan(caps.length / 2);
    // a layer cut into several steps says which part
    const parts = m.steps.map((_, si) => layerCaption(m, si)).filter(c => c?.includes(' · part '));
    expect(parts.length).toBeGreaterThan(0);
  });

  it('keeps each ribbon step to 20 kinds of piece or fewer', () => {
    for (const [id, mode] of CASES) for (const scale of ['large', 'small'] as const) {
      const m = model(id, mode, scale);
      m.steps.forEach((ids, si) => { if (ids.every(i => m.pieces[i].role === 'squiggle')) expect(stepParts(m, si).length, `#${id} ${mode} ${scale} step ${si + 1}`).toBeLessThanOrEqual(20); });
    }
  });

  it('mutes earlier pieces toward grey, black stays dark and colours keep their hue', () => {
    const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
    const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    expect(lum(ghost('#1B1B1B'))).toBeLessThan(90);          // black: dark grey, not light grey
    expect(lum(ghost('#F4F4F4'))).toBeGreaterThan(200);      // white: still light
    for (const s of SPECTRUM) {
      const a = rgb(renderHex(s.id)), b = rgb(ghost(renderHex(s.id))), top = a.indexOf(Math.max(...a));
      expect(b.indexOf(Math.max(...b)), s.name).toBe(top);   // the dominant channel stays
      expect(Math.max(...b) - Math.min(...b), s.name).toBeLessThan(Math.max(...a) - Math.min(...a));
    }
  });
});

describe('page texts', () => {
  it('splits a step note into its lead and a capitalised text', () => {
    expect(splitNote('Lighting notes: an LED strip can run under the socle.')).toEqual({ lead: 'Lighting notes', body: 'An LED strip can run under the socle.' });
    expect(splitNote('Hidden supports: 36 × Plate')).toEqual({ lead: 'Hidden supports', body: '36 × Plate' });
    expect(splitNote('Build the ribbon flat on the table, layer by layer: it holds.').lead).toBe('');
    for (const [, mode] of CASES) for (const note of Object.values(model(1234, mode).stepNotes)) expect(splitNote(note).body[0]).toMatch(/[A-Z0-9]/);
  });
  it('draws one hook or two, as the fixing advice says', () => {
    expect(hooksFor(model(1234, 'frame').hanging!.advice)).toBe(model(1234, 'frame').grams >= 1000 && model(1234, 'frame').grams < 3000 ? 2 : hooksFor(model(1234, 'frame').hanging!.advice));
    expect(hooksFor('About 0.8 kg: tie a picture cord through the holes of the two top Technic bricks and hang it on one picture hook.')).toBe(1);
    expect(hooksFor('About 1.3 kg: tie a picture cord through the holes of the two top Technic bricks and hang it on two picture hooks, or on a screw with a wall plug.')).toBe(2);
    expect(hooksFor('About 3.2 kg: tie a picture cord through the holes of the two top Technic bricks and hang it on two screws with wall plugs.')).toBe(2);
  });
  it('names the Squiggle like the page does', () => {
    const m = model(1234, 'frame'), src = { id: null, hash: null, features: {}, origin: 'upload' as const, original: '' };
    expect(new SqPageMaker(m, src).title).toBe('My Chromie Squiggle · Frame · Large · 64 × 32 studs');
    expect(new SqPageMaker(m, { ...src, id: 1234, origin: 'script' }).title).toBe('Chromie Squiggle #1234 · Frame · Large · 64 × 32 studs');
  });
});

describe('nameplate print sheet', () => {
  it('prints real size copies with cut marks inside both A4 and US Letter, apart, with a 50 mm bar', () => {
    expect(PAGE_PX[0] / PAGE_PX[1]).toBeCloseTo(PAGE_MM[0] / PAGE_MM[1], 2);
    const [fw, fh] = NAMEPLATE_MM, reach = PRINT.gap + PRINT.mark;
    // an A4 page printed at 100 % on Letter (279.4 × 215.9 mm) is centred: 8.8 mm lost left and right
    const lost = (PAGE_MM[0] - 279.4) / 2, safe = { x0: lost + 5, y0: 8, x1: PAGE_MM[0] - lost - 5, y1: PAGE_MM[1] - 90 / (PAGE_PX[0] / PAGE_MM[0]) };
    const boxes = PRINT.slots.map(([x, y]) => ({ x0: x - reach, y0: y - reach, x1: x + fw + reach, y1: y + fh + reach }));
    for (const b of boxes) {
      expect(b.x0).toBeGreaterThanOrEqual(safe.x0); expect(b.x1).toBeLessThanOrEqual(safe.x1);
      expect(b.y0).toBeGreaterThanOrEqual(safe.y0); expect(b.y1).toBeLessThanOrEqual(safe.y1);
    }
    // faces (with their bleed) never under another copy's marks
    PRINT.slots.forEach(([x, y], i) => boxes.forEach((b, j) => {
      if (i === j) return;
      const f = { x0: x - PRINT.bleed, y0: y - PRINT.bleed, x1: x + fw + PRINT.bleed, y1: y + fh + PRINT.bleed };
      expect(f.x1 <= b.x0 || b.x1 <= f.x0 || f.y1 <= b.y0 || b.y1 <= f.y0).toBe(true);
    }));
    expect(PRINT.bar[0] + 50).toBeLessThanOrEqual(safe.x1);
    expect(PRINT.bar[1]).toBeGreaterThan(Math.max(...PRINT.slots.map(s => s[1])) + fh + reach);
    expect(PRINT.bar[1]).toBeLessThanOrEqual(safe.y1);
  });
});
