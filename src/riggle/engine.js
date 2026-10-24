// ---------------------------------------------------------------------------
// The riggles art engine, vendored.
//
// This is the canonical renderer of the Riggles collection, byte for byte as
// it is published: the same engine the contracts store onchain, the same one
// the API serves at GET /v1/art/engine.js. It is here so this site can redraw
// a riggle in the visitor's browser with no network call and no API key.
//
// Do not edit the body. The only local change is the export line at the end of
// the file, which opens up buildGeom and cumOf so the brick builder can read
// the square wave's vertices. To take a newer engine, copy the file again and
// re-apply that one line.
//
// The MIT license in LICENSE covers this repository's own code. It does not
// cover the riggles artwork or this engine.
// ---------------------------------------------------------------------------
// RIGGLES — clean renderer. Vanilla Canvas 2D, responsive (draws at container size = crisp).
// STATIC views draw the whole wave. ANIMATION is OUR banner/website mechanic (make-riggle-
// loop.mjs): a fixed-length worm = window [b-DL, b] of an EXTENDED path (off-screen lead-in ->
// wave -> off-screen lead-out). Head leads, body flows in behind it into the final wave, holds
// (colours cycle), then crawls off. NOT Chromie colour-cycling, NOT draw-in-place-then-slide.

export const PALETTE = ['#000000', '#CCFF00'];
const COLORSPAN = 7000;
const map = (v, a, b, c, d) => c + ((v - a) * (d - c)) / (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// trapezoidal ease: brief ramp-up, CONSTANT crawl speed in the middle, brief ramp-down. Constant
// speed = the whole worm body moves together (no dart-then-settle accordion).
const trap = (p, e = 0.22) => { const v = 1 / (1 - e); if (p < e) return v * p * p / (2 * e); if (p < 1 - e) return v * (p - e / 2); const q = 1 - p; return 1 - v * q * q / (2 * e); };
const T_IN = 0.33, T_HOLD = 0.34;              // + T_OUT = 0.33; colour cycles during the hold
// Where a piece RESTS in its loop, as {TI, TH} = rest start and rest length (loop fractions).
// Inverted re-splits: crawl fractions shrink so that with its 1.35x loop the crawl's ABSOLUTE
// duration equals every other piece (0.245 * 1.35 = 0.33) and only the hold (wipes + beats)
// gets the extra time. Smoky: 1.5x loop, hold fraction shrunk so the colour cycle runs at the
// standard absolute rate. drawRiggle, animateRiggle, PHASE and loopMsOf all read from here.
export const restOf = (t) => t.legendary === 'inverted' ? { TI: 0.245, TH: 0.51 } : t.smoke ? { TI: 0.3867, TH: 0.2267 } : { TI: T_IN, TH: T_HOLD };
const loopScale = (t) => (t.legendary === 'inverted' ? 1.35 : t.smoke ? 1.5 : 1);

export function parseHash(hash) {
  const D = [];
  for (let j = 0; j < 32; j++) D.push(parseInt(hash.slice(2 + j * 2, 4 + j * 2), 16));
  const boldRaw = D[23] < 13;
  const sf = D[26] / 255;
  // step ceiling capped at 14: the box is fixed, so thickness + separation win over raw density.
  let steps;
  // PIXELATED = the constellation look (Cap's early reference render) — the ONE pixel type.
  // The nearest-neighbour resample experiment was cut in QA.
  const fuzzyRaw = D[22] < 8 && !(D[31] < 45);   // Chromie's fuzzy slot, kept rare (~2.7%)
  // SMOKY (QA-approved 2026-08-27): the soft-cloud body with billow/churn animation. Rolls the
  // next byte-22 window, and EXCLUDES abrupt colour behaviour - no Hyper Rainbow, no Hard Facet
  // (those hashes fall through to a normal body). Legendary-tier rarity: ~1% of supply.
  const smokeRaw = D[22] >= 8 && D[22] < 12 && !(D[31] < 45) && D[28] >= 6 && (D[21] & 0x0f) <= 12;
  const bold = boldRaw && !(D[31] < 45) && !fuzzyRaw && !smokeRaw;   // Chromie: bold yields to slinky AND fuzzy
  if (bold) steps = 3 + Math.floor(sf * 4);
  else if (sf < 0.70) steps = 4 + Math.floor((sf / 0.70) * 4.999);          // 4-8 common (chunky)
  else if (sf < 0.92) steps = 9 + Math.floor(((sf - 0.70) / 0.22) * 2.999); // 9-11 medium
  else steps = 12 + Math.floor(((sf - 0.92) / 0.08) * 2.999);               // 12-14 dense (rare)
  const af = Math.pow(D[27] / 255, 1.3);
  const ht = bold ? 2.4 + af * 1.3 : 2.15 + af * 1.95;
  const hyper = D[28] < 6;
  const spread = hyper ? 0.5 : map(D[28], 0, 255, 5, 50);
  // INTENSITY (byte 15, previously unused). Saturation/value was a dead axis — every piece was
  // hsl(h,100%,50%). Chromie is the same (fill(hue,255,255)) and only gets value variation from its
  // fuzzy mode, which we cut. This gives the collection a neon / deep / pastel axis on top of hue.
  const iv = D[15];
  const intensity = iv < 140 ? 'neon' : iv < 200 ? 'deep' : 'pastel';
  const satPct = intensity === 'pastel' ? 62 : 100;
  const lightMul = intensity === 'deep' ? 0.72 : intensity === 'pastel' ? 1.4 : 1;
  // COMPOSITION traits (byte 16, previously unused — split into two nibbles).
  // Envelope reshapes the amplitude across the piece; drift tilts its baseline. Together these are
  // what make Chromie's silhouettes differ; ours all filled the frame identically before this.
  const ev = D[16] >> 4, dv = D[16] & 0x0f;
  const envelope = ev <= 7 ? 'even' : ev <= 9 ? 'cresc' : ev <= 11 ? 'dim' : ev <= 13 ? 'bulge' : 'pinch';
  const drift = dv <= 8 ? 0 : dv <= 11 ? 1 : dv <= 14 ? -1 : (dv % 2 ? 1.6 : -1.6);   // last = steep tilt
  // LEGENDARY render modes (byte 18, previously unused). Ultra-rare inversions of how the piece is
  // drawn at all — not another colourway. Inverted floods the field and cuts the riggle out of it.
  const lv = D[18];
  const legendary = lv < 3 ? 'inverted' : lv < 5 ? 'outline' : lv < 7 ? 'duotone' : 'none';
  const startColor = D[29];
  const reverse = D[30] < 128;
  // BODY STYLE is ONE exclusive value, resolved by priority exactly like Chromie's generator
  // (bold circle size only when !slinky; segmented draws only when !slinky && !bold). Outline
  // takes over the body render the way Chromie's fuzzy does, so it suppresses the coil/stack.
  const pipe = D[22] < 40;
  let slinky = D[31] < 45;
  let fuzzy = fuzzyRaw;
  let smoke = smokeRaw && legendary === 'none';   // legendaries keep their own bodies (as QA'd)
  if (legendary === 'outline') { slinky = false; fuzzy = false; }   // outline owns the body
  const ribbed = !slinky && !fuzzy && !smoke && !bold && legendary !== 'outline' && D[24] < 40;
  const ribDiv = Math.floor(map(D[24], 0, 255, 3, 20));
  const dotCol = D[25];
  // COLOUR SPREAD — Chromie-faithful CONTINUOUS model (replaces the v2 disjoint bands).
  // Chromie: spread is a continuous 5-50 value, hue = colour/spread, so hue coverage falls off
  // hyperbolically — most of the supply sits in one colour family, rainbows are the thin tail,
  // and there are no band seams because there are no bands. wheels = 11/spread gives us exactly
  // that falloff in our wheels-swept terms: spread 50 -> 0.22 wheels (tight family), spread 11 ->
  // 1.0 (the full rainbow), spread 5 -> 2.2 (double wheel). Hyper is the spread-0.5 equivalent,
  // capped to 5.5-7.0 wheels so it STRIPES at our stamp density instead of aliasing to noise.
  // Spread itself is surfaced as a numeric metadata trait, like Chromie's "Color Spread".
  // Greyscale stays ours (Chromie has none): a value sweep instead of a hue sweep.
  const specN = D[21] >> 4;
  const spectrum = specN >= 14 ? 'grey' : 'normal';
  const u = clamp((spread - 5) / 45, 0, 1);
  const wheels = hyper ? 5.5 + (D[28] / 5) * 1.5
    : spectrum === 'grey' ? 0.20 + u * 0.50               // greyscale value sweep
    : 11 / spread;
  const spreadEff = COLORSPAN / 255 / wheels;
  const treatN = D[21] & 0x0f;
  const treatment = treatN <= 9 ? 'smooth' : treatN <= 12 ? 'soft' : 'hard';
  const pv = D[19];
  const path = pv < 58 ? 'LR' : pv < 116 ? 'RL' : pv < 168 ? 'TB' : pv < 220 ? 'BT' : 'orbit';
  const fillDial = D[20] / 255;
  // volt bg allowed ONLY if NO stroke hue lands near volt-yellow (hsl(72,100%,50%) IS volt, so a
  // stroke in ~58-88 deg vanishes against it). Sample the sweep finely; require zero near-volt hits.
  // Greyscale: dark/black-heavy pieces CAN take volt, but majority-WHITE pieces are black bg only.
  let voltOk = true;
  if (spectrum === 'grey') {
    let light = 0;
    for (let k = 0; k < 64; k++) { let v = (((k / 64) * (COLORSPAN / spreadEff) + startColor) % 255 + 255) % 255; if (reverse) v = 255 - v; if (v > 142) light++; }  // L > ~68%
    voltOk = light < 32;                                    // majority-white -> black bg
  } else {
    // exclude the whole yellow->green->spring band (~50-160 deg): any green-family stroke washes on volt
    for (let k = 0; k < 64 && voltOk; k++) { let h = ((k / 64) * (COLORSPAN / spreadEff) + startColor) % 255; if (reverse) h = 255 - h; const deg = (h / 255) * 360; if (deg >= 50 && deg <= 160) voltOk = false; }
  }
  const bgBit = (D[1] & 1) === 1 && voltOk ? 1 : 0;
  return { D, steps, ht, hyper, spread, startColor, reverse, bold, pipe, slinky, ribbed, ribDiv, dotCol, spectrum, treatment, path, fillDial, voltOk, bgBit, spreadEff, wheels, intensity, satPct, lightMul, envelope, drift, legendary, fuzzy, smoke };
}

// ONE type per piece, resolved by priority — Chromie's model (their booleans overlap in the hash
// too; the render suppressions make the community Type table sum to 100% with no combos).
export const typeLabel = (t) => (t.slinky && t.pipe ? 'Corrugated Pipe' : t.slinky ? 'Corrugated' : t.fuzzy ? 'Pixelated' : t.smoke ? 'Smoking' : t.bold ? 'Thick' : t.ribbed ? 'Accordion' : 'Normal') + ' Riggle';
export const spectrumLabel = (t) => t.hyper ? 'Hyper Rainbow' : t.spectrum === 'grey' ? 'Greyscale' : 'Normal';
// Chromie exposes Color Spread as a raw numeric trait; so do we (0.5 = hyper, else 5-50).
export const spreadLabel = (t) => t.hyper ? '0.5' : String(Math.round(t.spread));
export const treatmentLabel = (t) => ({ smooth: 'Continuous', soft: 'Soft Facet', hard: 'Hard Facet' }[t.treatment]);
export const pathLabel = (t) => ({ LR: 'Left to Right', RL: 'Right to Left', TB: 'Top to Bottom', BT: 'Bottom to Top', orbit: 'Orbital' }[t.path]);
// second animation trait: HOW the colours cycle during the centre hold (derived from spectrum/treatment)
export const envelopeLabel = (t) => ({ even: 'Even', cresc: 'Crescendo', dim: 'Diminuendo', bulge: 'Bulge', pinch: 'Pinch' }[t.envelope]);
export const driftLabel = (t) => t.drift === 0 ? 'Level' : Math.abs(t.drift) > 1 ? (t.drift > 0 ? 'Steep Rise' : 'Steep Fall') : (t.drift > 0 ? 'Rising' : 'Falling');
export const legendaryLabel = (t) => ({ inverted: 'Inverted Riggle', outline: 'Outline Riggle', duotone: 'Duotone Riggle', none: 'None' }[t.legendary]);
// The colour identity, surfaced: Chromie exposes Start Color / Color Direction as traits; the
// anchor byte is what makes a piece 'the teal one'. 12 hue families from the effective anchor.
const FAM = ['Red','Orange','Yellow','Lime','Green','Mint','Cyan','Azure','Blue','Violet','Purple','Rose'];
export const familyLabel = (t) => {
  if (t.spectrum === 'grey') return 'Greyscale';
  if (t.hyper || t.wheels >= 0.95) return 'Rainbow';      // a full wheel swept = no single family
  const anchor = t.reverse ? 255 - t.startColor : t.startColor;
  return FAM[Math.floor((anchor / 255) * 360 / 30) % 12];
};
export const directionLabel = (t) => t.reverse ? 'Reverse' : 'Forward';
export const cycleLabel = (t) => t.spectrum === 'grey' ? 'Shade Wave' : t.hyper ? 'Hyper Cycle' : t.treatment === 'hard' ? 'Block Shift' : 'Hue Sweep';

function buildGeom(t, W, H, circleSafe) {
  const minDim = Math.min(W, H);
  const side = minDim;                              // riggle lives in a square of this side —
  const boxX = (W - side) / 2, boxY = (H - side) / 2; // centered, so a WIDE canvas just adds
  const n = Math.max(4, t.steps);                  // side bg, no stretch
  // stroke scales DOWN with step count, AND is capped by GAP FEASIBILITY: a piece with n risers can
  // only be as thick as still fits n runs of >= 1.35*S in the box. Gaps are a hard guarantee — a
  // thick stroke may not eat them (that was the blob). Bold is exempt (overlap is its style).
  // With steps capped at 14, even the densest piece stays ~side/33 and the common 4-8 band is chunky.
  let Sraw = t.bold ? minDim / 9 : clamp((side * 0.70) / (n * 1.35), minDim / 26, minDim / 10);
  if (!t.bold && !t.slinky) Sraw = Math.min(Sraw, (side * 0.62) / (n * 1.35 + 1));  // feasibility cap
  // corrugated coils stamp at 1.5*S, so they need a BIGGER gap or low-step pieces merge into a
  // hatched clump with no visible wave (QA audit finding). Bold stays overlap-exempt.
  if (t.slinky && !t.bold) Sraw = Math.min(Sraw, (side * 0.62) / (n * 1.9 + 1));
  let S = 2 * Math.max(2, Math.round(Sraw / 2));
  const SAFE = 0.16;                                // generous margins (Chromie-like), applied to ALL views
  const insetX = side * SAFE + S / 2, insetY = side * SAFE + S / 2;
  const drawW = side - insetX * 2;
  const halfH = side / 2 - insetY;
  const yAt = (i) => map(t.D[i % 21], 0, 255, -halfH, halfH);
  const w = [];
  // stride 5 is coprime with 21, so every run reads a DIFFERENT hash byte (stride 3 had period 7:
  // runs 7-13 reused the widths of runs 0-6, giving dense pieces a repeated rhythm).
  for (let k = 0; k < n; k++) w.push(0.75 + (t.D[(k * 5 + 3) % 21] / 255) * 1.05);
  const wsum = w.reduce((a, b) => a + b, 0);
  let wS = t.bold ? 2 * Math.round((S * 1.55) / 2) : S;
  const minRun = t.bold ? 0 : t.slinky ? S * 1.9 : S * 1.35;   // corrugated gap sized to its 1.5S stamp
  const base = drawW / wsum;
  // WATERFALL fit (replaces uniform xscale, which re-compressed the min gaps away): runs floored to
  // minRun KEEP it; only the longer runs shrink to make the total fit. Min gaps survive verbatim.
  let runsPx = w.map((u) => u * base);
  if (minRun > 0) {
    for (let it = 0; it < 6; it++) {
      let fixed = 0, flex = 0;
      for (const r of runsPx) { if (r <= minRun + 0.01) fixed += minRun; else flex += r; }
      const avail = Math.max(0, drawW - fixed);
      if (flex <= 0) break;
      const sc2 = avail / flex;
      let hitFloor = false;
      runsPx = runsPx.map((r) => { if (r <= minRun + 0.01) return minRun; const nr = r * sc2; if (nr < minRun) { hitFloor = true; return minRun; } return nr; });
      if (!hitFloor) break;
    }
  }
  const xscale = 1;
  const minRise = S * 1.1;
  const V = [];
  let cy = yAt(0), cx = 0;
  V.push({ x: 0, y: cy });
  for (let k = 0; k < n; k++) {
    cx += runsPx[k] * xscale;
    let yN = yAt(k + 1);
    const dy = yN - cy;
    if (Math.abs(dy) < minRise) yN = cy + (dy === 0 ? (k % 2 ? 1 : -1) : Math.sign(dy)) * minRise;
    yN = Math.min(halfH, Math.max(-halfH, yN));
    V.push({ x: cx, y: cy }); V.push({ x: cx, y: yN }); cy = yN;
  }
  {
    let ymin = Infinity, ymax = -Infinity;
    for (const v of V) { if (v.y < ymin) ymin = v.y; if (v.y > ymax) ymax = v.y; }
    const yc = (ymin + ymax) / 2, ext = Math.max(1, ymax - ymin);
    const freqDamp = 1 - Math.min(0.52, Math.max(0, n - 7) / 26);
    const fill = (0.52 + t.fillDial * 0.48) * freqDamp;
    const sc = Math.min(1.5, (2 * halfH * fill) / ext);
    for (const v of V) v.y = Math.max(-halfH, Math.min(halfH, (v.y - yc) * sc));

    // COMPOSITION: envelope + baseline drift. Normalising every piece to fill the frame gave the
    // whole collection one silhouette — a centred, height-filling skyline. Chromie gets calm pieces
    // and violent ones for free because it never normalises. Applied PER PLATEAU (both vertices of a
    // horizontal run share the factor) so runs stay perfectly horizontal — never a diagonal.
    const xEnd = V[V.length - 1].x || 1;
    const envAt = (p) => {
      switch (t.envelope) {
        case 'cresc': return 0.32 + 0.68 * p;                    // builds left to right
        case 'dim': return 1 - 0.68 * p;                         // decays left to right
        case 'bulge': return 0.34 + 0.66 * Math.sin(Math.PI * p); // quiet ends, loud middle
        case 'pinch': return 1 - 0.6 * Math.sin(Math.PI * p);    // loud ends, quiet middle
        default: return 1;
      }
    };
    const driftAt = (p) => t.drift * halfH * 0.34 * (p - 0.5) * 2;
    for (let j = 0; j * 2 + 1 < V.length; j++) {
      const a = V[j * 2], b = V[j * 2 + 1];                      // one plateau = one y level
      const p = clamp(((a.x + (b ? b.x : a.x)) / 2) / xEnd, 0, 1);
      const y = clamp(a.y * envAt(p) + driftAt(p), -halfH, halfH);
      a.y = y; if (b) b.y = y;
    }
    // envelope can squash two neighbouring levels together; restore a visible riser between them
    for (let j = 1; j * 2 + 1 < V.length; j++) {
      const prev = V[j * 2 - 1], cur = V[j * 2];
      const d = cur.y - prev.y;
      if (Math.abs(d) < minRise) {
        const dir = d === 0 ? (j % 2 ? 1 : -1) : Math.sign(d);
        const ny = clamp(prev.y + dir * minRise, -halfH, halfH);
        cur.y = ny; if (V[j * 2 + 1]) V[j * 2 + 1].y = ny;
      }
    }
  }
  // Fit the whole shape inside the avatar-safe circle by UNIFORM scale (shape preserved -> no
  // per-vertex clamp -> no diagonals). Runs for EVERY view (circleSafe param ignored), so the square
  // PFP and the wide collection render the IDENTICAL shape, always avatar-safe with a clean margin.
  // The stroke scales WITH the shape. Scaling positions alone silently destroys the minimum gap:
  // a 27px run with a 20px stroke (7px gap) squeezed by f=0.8 becomes a 21px run with the SAME 20px
  // stroke — a 1px hairline. Line weight is part of the drawing, so it shrinks by the same f.
  {
    const cxC = drawW / 2, R = minDim / 2 - minDim * 0.11;   // shape/circle centre; safe radius
    let stampHalf = wS / 2; if (t.slinky) stampHalf += S / 8;
    let maxR = 0; for (const v of V) { const r = Math.hypot(v.x - cxC, v.y) + stampHalf; if (r > maxR) maxR = r; }
    if (maxR > R) {
      const f = R / maxR;
      for (const v of V) { v.x = cxC + (v.x - cxC) * f; v.y = v.y * f; }
      S = 2 * Math.max(2, Math.round((S * f) / 2));           // keep the gap ratio intact
      wS = t.bold ? 2 * Math.round((S * 1.55) / 2) : S;
    }
  }
  for (const v of V) { v.x = Math.round(v.x); v.y = Math.round(v.y); }
  // rounding can still leave a 1-2px sliver where two bars should touch; pull those flush.
  // Anything wider is a real gap the geometry asked for and is left alone.
  for (let k = 1; k + 3 < V.length; k += 2) {
    const xA = V[k].x, xB = V[k + 2].x;
    const slit = Math.abs(xB - xA) - wS;
    if (slit === 1 || slit === 2) { const d = Math.sign(xB - xA) * slit; V[k + 2].x -= d; if (k + 3 < V.length) V[k + 3].x -= d; }
  }
  return { V, S, wS, originX: boxX + insetX, offsetY: boxY + side / 2 };
}

// build cumulative path lengths for a point list
function cumOf(pts) { const c = [0]; for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)); return c; }

// Unified renderer: draws the arc WINDOW [a,b] of a polyline with a treatment (slinky outlines,
// ribbed dots, smooth/soft gradient, hard facet). colorFor(tt) returns the colour for param tt;
// paramAt(arc) maps arc -> tt. BOTH the static view and the worm animation route through this, so
// the animation renders IDENTICALLY to the static (just windowed + an optional hue offset baked
// into colorFor). Window [0,total] = full static; window [b-DL,b] = the crawling worm.
function drawSpan(ctx, pts, cum, a, b, t, S, wS, colL, paramAt, bgCol, anchor, gridDir, phase, smokeMf, smokeTau, smokeAmp, smokeLand, smokeSig) {
  const total = cum[cum.length - 1]; a = Math.max(0, a); b = Math.min(total, b);
  if (b <= a) return;
  if (anchor == null) anchor = 0;
  if (gridDir == null) gridDir = 1;
  const h2 = wS / 2, treat = t.treatment, ribbed = t.ribbed && !t.bold;
  const bodyL = ribbed ? 34 : 50;                          // ribbed body = dimmer colour (so bright ribs pop),
  //                                                          but still a COLOUR (never black -> not a slinky)
  const at = (d) => { let k = 0; while (k < pts.length - 2 && cum[k + 1] < d) k++; const u = (d - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]); return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u }; };
  // marched stamps (coil + accordion) sit on a FIXED grid anchored to the BODY (anchor = snapped
  // body start), NOT resampled from the moving window — stamps keep their position AND colour
  // between whole-segment snaps. This killed the per-frame coil strobe.
  // stamps sit on a fixed grid anchored at the PARAM-0 end (anchor + gridDir*j*pitch), so stamp
  // PARAMS match the static grid exactly in either traversal direction, and paint in ASCENDING
  // param order (canonical = static's) so overlap ownership never flips.
  const stamps = (pitch, fn) => {
    const lo = gridDir > 0 ? (a - anchor) / pitch : (anchor - b) / pitch;
    const hi = gridDir > 0 ? (b - anchor) / pitch : (anchor - a) / pitch;
    const ds = [];
    for (let j = Math.ceil(lo - 1e-6); j <= Math.floor(hi + 1e-6); j++) { const d = anchor + gridDir * j * pitch; if (d < a - 0.01 || d > b + 0.01) continue; ds.push(d); }
    ds.sort((u, v) => paramAt(u) - paramAt(v)); for (const d of ds) fn(d);
  };
  if (t.smoke) {                                           // SMOKY — the soft cloud, PROPER motion:
    // Puffs sit on a FIXED absolute grid along the path (anchor 0, never window-relative), so a
    // moving worm slides continuously over stationary smoke - no segment-snap chop, no boil.
    // Behind the window the puffs DISSIPATE: alpha falls off across ~3 stroke-widths of tail,
    // and the head fades in softly. Fades apply only to true worm windows - a full-path draw
    // (static, hold) renders every puff at full strength, identical to the approved static.
    // Grid AND noise are anchored to the SIGNATURE start (the anchor arg; 0 for a full-path
    // draw). The extended worm path put the grid off by the lead-in length, so every hold<->crawl
    // transition re-seeded the cloud a half-step over - the position pop QA caught.
    // BILLOW: puffs behind the worm age with distance - they expand, drift outward, rise a
    // little, and fade. Smoke pours off the tail instead of switching off.
    const rj = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const prevA = ctx.globalAlpha;
    const pitch = S / 5, tailL = S * 5, headL = S * 0.8;   // long lingering vapor tail
    const base = anchor || 0, dir = gridDir || 1;
    const win = a > 0.01 || b < total - 0.01;               // true worm window (not the full path)
    // dir = -1 for REVERSED worm paths: their pts run the signature backward, so the grid anchors
    // at the signature END and steps back - puff k sits at the same signature point (and takes
    // the same noise seed k*pitch) as the static's puff k. Forward paths: anchor start, step fwd.
    // VAPOR ONLY WHERE THE WORM HAS BEEN: as the crawl-out starts, the tail may not reach
    // behind the rest position - it grows with distance travelled (QA: a fixed 5S tail zone
    // painted vapor along the body's own arc the instant the worm moved, reading as the riggle
    // EXTENDING). As = the signature start arc in this window's coordinates.
    const As = dir > 0 ? base : base - (b - a);
    const tail0 = a > As ? Math.max(As, a - tailL) : a - tailL;
    const lo = Math.max(0, win ? tail0 : a), hi = Math.min(total, b);
    // PUFFS LIVE ON THE CANVAS, NOT ON THE ARC. The walk samples the path finely,
    // quantizes each sample to a canvas cell one pitch wide, and grows exactly one
    // puff per cell, seeded by the cell. That single invariant is the perfect
    // loop: any two frames that draw the same geometry - the colour-cycle frame,
    // the travel's first frame, its landing frame - produce the identical set of
    // puffs, because arc bookkeeping (window offsets, tour length, direction)
    // never touches where a puff is or what it looks like. Arc-grid sampling
    // could not do this: the tour is not a whole number of pitches long, so the
    // landing frame sampled the wave at different points than the resting frame
    // (the end-of-path position jump - QA, Cap 2026-09-01). Cell coords are
    // S-relative, so the cloud is also identical at every render size.
    // Cell width is the density dial. One-per-pitch cells read thinner than the
    // old arc packing did in tight zigzags (QA, Cap: "looks, less"), so the
    // cells are finer than the pitch - more cells, fuller cloud, same invariant.
    const cellW = S / 8;
    const stepA = cellW / 2;
    const seen = new Set();
    // Samples sit on a FIXED arc grid anchored at the signature (base), not at the moving tail
    // (lo): sampling from lo slid each puff's sample point up to stepA along its cell every
    // frame, so on the crawl every puff vibrated in place. Full-path draws start at 0 as before.
    // Reversed paths walk the grid DOWN, i.e. in signature order like the static, so each cell
    // keeps the static's sample and paint order: walking it up handed every cell the sample
    // from its far side, and every puff hopped as the hold switched to the crawl and back.
    const d0 = dir > 0 ? base + Math.ceil((lo - base) / stepA - 1e-9) * stepA : base + Math.floor((hi - base) / stepA + 1e-9) * stepA;
    // smokeLand (orbit): the arc where the tour's second signature copy starts. Its puffs take a
    // grid anchored THERE, so the landing samples the wave at the static's points; one grid from
    // 0 reached it off by a fraction of a step and the whole cloud hopped as the orbit landed.
    let land = smokeLand == null || dir < 0 ? null : smokeLand;
    // ONE PUFF PER RUN START. A cell's puff is drawn from the FIRST sample of its run (the
    // consecutive samples inside the cell, in walk order), and only while that sample is in
    // the window. Taking whichever sample came first in the window instead made a puff hop
    // one step every time the window edge reached another sample of its cell. Runs break at
    // the signature's ends (and the orbit's landing copy), so the signature's cells keep the
    // static's samples. For a full-path draw this is the old first-sample rule exactly.
    const st = dir > 0 ? stepA : -stepA, Ae = As + (b - a);
    const zone = (x) => (x < As - 1e-6 ? 0 : x > Ae + 1e-6 ? 2 : 1) + (smokeLand != null && x > smokeLand - 1e-6 ? 3 : 0);
    const cross = (u, v) => zone(u) !== zone(v);
    // SIGNATURE SAMPLES BY THE STATIC'S OWN ROUTE. The geometry is integer, so many samples
    // sit EXACTLY on a cell edge, and the crawl reached them through other floats (reversed
    // points, extended path, offset arcs): a 1e-13 difference flipped the cell and hopped its
    // puff as the hold switched to the crawl. smokeSig is the signature polyline the static
    // draws; inside the signature a sample is taken there, at the static's own accumulated
    // arc, so the crawl, the hold and the static pick bit-identical points.
    const atS = smokeSig && ((d) => { const P = smokeSig.pts, C = smokeSig.cum; let k = 0; while (k < P.length - 2 && C[k + 1] < d) k++; const u = (d - C[k]) / Math.max(1e-6, C[k + 1] - C[k]); return { x: P[k].x + (P[k + 1].x - P[k].x) * u, y: P[k].y + (P[k + 1].y - P[k].y) * u }; });
    const sAcc = []; if (smokeSig) { const sT = smokeSig.cum[smokeSig.cum.length - 1]; for (let v = 0; v <= sT + 1e-6; v += stepA) sAcc.push(v); }
    const pos = (d) => {
      if (smokeSig) { const z = zone(d); const k = z === 1 ? Math.round(dir > 0 ? (d - As) / stepA : (Ae - d) / stepA) : z === 5 ? Math.round((d - smokeLand) / stepA) : -1; if (k >= 0 && k < sAcc.length) return atS(sAcc[k]); }
      return at(d);
    };
    const cellOf = (q) => Math.round(q.x / cellW) * 131071 + Math.round(q.y / cellW);
    let prevKey = null, prevD = d0 - st;
    if (win && prevD >= 0 && prevD <= total) prevKey = cellOf(pos(prevD));
    for (let d = d0; dir > 0 ? d <= hi : d >= lo - 1e-9; d += st) {
      if (land != null && d > land - 1e-9) { d = land + Math.max(0, Math.ceil((lo - land) / stepA - 1e-9)) * stepA; land = null; prevKey = null; if (d > hi) break; }
      const p = pos(d);
      const cellX = Math.round(p.x / cellW), cellY = Math.round(p.y / cellW);
      const cellKey = cellX * 131071 + cellY;
      const runOn = prevKey === cellKey && !cross(prevD, d);
      prevKey = cellKey; prevD = d;
      if (runOn || seen.has(cellKey)) continue;
      const dn = cellX * 7.31 + cellY * 3.17;
      let age = 0, am = 1;
      // mf = motion factor from the caller: 1 mid-crawl, ramping to 0 as the worm reaches its
      // rest position - fades and wisps converge into the exact static instead of popping off.
      const mf = smokeMf == null ? 1 : smokeMf;
      if (win && mf > 0) {
        if (d < a) { age = Math.min(1, (a - d) / tailL); am = Math.pow(1 - age, 1.25) * mf; }  // gentle dissipation - stays longer
        else { const hd = (b - d) / headL; if (hd < 1) am = 1 - (1 - Math.max(0, hd)) * mf; }
      } else if (win && d < a) am = 0;
      if (am <= 0.004) continue;
      seen.add(cellKey);                                    // an invisible sample never claims a cell
      for (let j = 0; j < 6; j++) {
        const r1 = rj(dn + j * 13.37), r2 = rj(dn * 1.7 + j * 7.77), r3 = rj(dn * 2.3 + j * 3.33);
        const bx = ((r1 + rj(dn * 3.1 + j)) / 2 - 0.5), by = ((r2 + rj(dn * 4.7 + j)) / 2 - 0.5);
        let dx = bx * S * 1.25, dy = by * S * 1.25;
        const dxs = dx, dys = dy;                           // the puff's static offset
        if (Math.hypot(dx, dy) > S * 0.62) continue;
        const bloom = 1 + age * 0.9;                        // expand + disperse + rise with age
        dx *= bloom; dy = dy * bloom - age * S * 0.5;
        let szf = S * (0.12 + r3 * 0.5) * (1 + age * 1.4), aC = 1;
        // AMBIENT CHURN (any animated frame, hold included): every puff lives a cycle - born
        // small and faint, rises and expands, fades out, reborn. sin envelope = 0 at both ends
        // of a life, so births/deaths never pop. Integer cycles per loop = seamless wrap. The
        // parked riggle breathes smoke during the colour cycle and the same churn flows
        // straight into the moving trail. Static renders (no tau) stay frozen.
        const ampA = smokeAmp == null ? 1 : smokeAmp;
        if (smokeTau != null && ampA > 0) {
          const off = rj(dn * 7.7 + j * 5.1);
          const spd = 3 + Math.floor(rj(dn * 2.9 + j * 1.3) * 3);
          const lf = ((smokeTau * spd + off) % 1 + 1) % 1;
          // life cycle CENTERED on the puff's home (born low/small, dies high/large) so the
          // cloud's mean equals the static; ampA scales every churn term to 0 at the loop entry
          // point, so the ignition frame IS the static and the smoke wakes from it.
          dx *= 1 + (lf - 0.5) * 0.5 * ampA; dy = dy * (1 + (lf - 0.5) * 0.5 * ampA) - (lf - 0.5) * S * 0.55 * ampA;
          szf *= 1 + (lf - 0.5) * 0.6 * ampA;
          aC = 1 + (Math.sin(lf * Math.PI) * 1.5 - 1) * ampA;
          // the rebirth jump (end of a life back to its start) is hidden only while aC is 0 there,
          // i.e. at full amplitude. Through the ignition and landing ramps a reborn puff stayed
          // partly visible and leapt; a fade at both ends of a life hides it there. Its width is
          // 0 at full amplitude (the walk and hold are untouched) and at 0 (the static).
          const wG = 0.48 * ampA * (1 - ampA);
          if (wG > 0) aC *= clamp(Math.min(lf, 1 - lf) / wG, 0, 1);
        }
        const sz = Math.max(2, Math.round(szf));
        ctx.globalAlpha = Math.min(0.35, 0.16 * am * aC);
        ctx.fillStyle = colL(paramAt(d), 50);
        // MOTION frames draw sub-pixel, as the STATIC's whole-pixel square plus how far the puff
        // has moved and grown from its static pose. Whole-pixel snapping every frame made a puff
        // drifting a fraction of a pixel per frame rock 1px back and forth (the vibration); this
        // is continuous, needs no mode switch, and at the static pose (the click, every landing,
        // the loop seam) draws the static's exact squares.
        if (smokeTau != null) {
          const szS = S * (0.12 + r3 * 0.5), sR = Math.max(2, Math.round(szS)), s = sR + (Math.max(2, szf) - Math.max(2, szS));
          ctx.fillRect(Math.round(p.x + dxs - sR / 2) + (dx - dxs) - (s - sR) / 2, Math.round(p.y + dys - sR / 2) + (dy - dys) - (s - sR) / 2, s, s);
        }
        else ctx.fillRect(Math.round(p.x + dx - sz / 2), Math.round(p.y + dy - sz / 2), sz, sz);
      }
    }
    ctx.globalAlpha = prevA;
    return;
  }
  if (t.fuzzy) {                                           // PIXELATED — the early reference look:
    // the riggle dissolved into a CONSTELLATION of grid-aligned pixels (riggle-24cf8ce7.png).
    // Two passes: pass 1 finds each cell's MINIMUM distance to the stroke core across all stamps
    // (a single first-touch pass let a distant stamp decide a core cell at halo odds and drop it —
    // that was the near-empty render). Pass 2 keeps/drops once per cell: dense keep in the core,
    // falloff in the halo, both modulated by low-frequency cluster noise so pixels CLUMP the way
    // the reference does instead of even speckle. Muted values via a charcoal blend overlay.
    const rj = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const cell = Math.max(2, Math.round(S / 3));
    const halo = S * 1.1, cells = new Map();
    stamps(cell * 0.8, (d) => {
      const p = at(d), pr = paramAt(d);
      const r = Math.ceil((wS / 2 + halo) / cell);
      const cx0 = Math.floor(p.x / cell), cy0 = Math.floor(p.y / cell);
      for (let iy = -r; iy <= r; iy++) for (let ix = -r; ix <= r; ix++) {
        const cx = cx0 + ix, cy = cy0 + iy;
        const qx = cx * cell + cell / 2, qy = cy * cell + cell / 2;
        const dist = Math.hypot(qx - p.x, qy - p.y);
        if (dist > wS / 2 + halo) continue;
        const key = cx * 131071 + cy, prev = cells.get(key);
        if (!prev || dist < prev.dist) cells.set(key, { dist, pr, cx, cy });
      }
    });
    const ph = phase || 0;                                 // colour-cycle phase: cells RE-ROLL as the
    for (const c of cells.values()) {                      // gradient runs — off pixels ignite, on
      const clus = 0.30 + rj(Math.floor(c.cx / 3) * 7.1 + Math.floor(c.cy / 3) * 13.7) * 0.85;  // clump factor
      const keepP = (c.dist <= wS / 2 ? 0.85 : 0.32 * (1 - (c.dist - wS / 2) / halo)) * clus;
      // pixels drop, silhouette holds. Integer re-rolls per cycle (faster later in the gradient) ->
      // phase 0 and phase 1 are BOTH the exact static pattern, so landing/exit never pops.
      const roll = rj(c.cx * 73.7 + c.cy * 151.3) - ph * (1 + Math.round(c.pr * 2));
      if (roll - Math.floor(roll) > keepP) continue;
      const rb = rj(c.cx * 3.3 + c.cy * 9.1);
      const L = 34 + Math.round(rb * 20) + (rb > 0.93 ? 16 : 0);   // muted band + rare bright accent
      const x = c.cx * cell, y = c.cy * cell;
      const rb2 = rj(c.cx * 17.9 + c.cy * 5.7);                    // accent pixels, per the reference:
      if (rb2 < 0.14) {                                            // some cells sit TRANSLUCENT
        ctx.globalAlpha = 0.35 + rb2 * 2;
        ctx.fillStyle = colL(c.pr, L); ctx.fillRect(x, y, cell, cell);
        ctx.globalAlpha = 1;
      } else if (rb2 > 0.90) {                                     // some carry a value gradient across
        const gd = ctx.createLinearGradient(x, y, x + cell, y + cell);
        gd.addColorStop(0, colL(c.pr, L + 14)); gd.addColorStop(1, colL(c.pr, Math.max(20, L - 12)));
        ctx.fillStyle = gd; ctx.fillRect(x, y, cell, cell);
      } else { ctx.fillStyle = colL(c.pr, L); ctx.fillRect(x, y, cell, cell); }
      ctx.fillStyle = 'rgba(40,40,40,0.35)'; ctx.fillRect(x, y, cell, cell);  // charcoal mute, per reference
    }
    return;
  }
  if (t.slinky) {                                          // dense overlapping square outlines = a COIL
    const sq = S * 1.5, pitch = S / 3.6;
    stamps(pitch, (d) => {
      // inverted's flat colour merged the overlapping rings into a solid tube (QA) - alternate
      // ring lightness by FIXED grid parity (stable across anim windows) to keep the coil texture.
      const ring = t.legendary === 'inverted' ? ((Math.round((d - anchor) / pitch) % 2 + 2) % 2 ? 36 : 64) : 50;
      const p = at(d), col = colL(paramAt(d), ring);
      if (t.pipe) { const P2 = sq * 1.12; ctx.lineWidth = Math.max(1, S / 9); ctx.strokeStyle = '#000'; ctx.strokeRect(p.x - P2 / 2, p.y - P2 / 2, P2, P2); }
      ctx.lineWidth = Math.max(1.4, S / 7); ctx.strokeStyle = col; ctx.strokeRect(p.x - sq / 2, p.y - sq / 2, sq, sq);
    });
    return;
  }
  if (ribbed) {                                            // RIBBED = a path of SQUARES, each solid-filled +
    const sq = wS;                                          // stroke, stacked in front. The stroke edges
    ctx.lineWidth = Math.max(1, S / 12); ctx.lineJoin = 'round';  // that peek out = the ribs.
    stamps(S / 3.2, (d) => {
      const p = at(d), pr = paramAt(d);
      const x = Math.round(p.x - sq / 2), y = Math.round(p.y - sq / 2);
      ctx.fillStyle = colL(pr, 46); ctx.fillRect(x, y, sq, sq);        // SOLID colour inside (never transparent)
      ctx.strokeStyle = colL(pr, 72); ctx.strokeRect(x + 0.5, y + 0.5, sq - 1, sq - 1);  // BRIGHT palette stroke
    });
    return;
  }
  const rects = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const s0 = Math.max(a, cum[k]), s1 = Math.min(b, cum[k + 1]); if (s1 <= s0) continue;
    const P = pts[k], Q = pts[k + 1], L = Math.max(1e-6, cum[k + 1] - cum[k]);
    const u0 = (s0 - cum[k]) / L, u1 = (s1 - cum[k]) / L;
    const x0 = Math.round(P.x + (Q.x - P.x) * u0), y0 = Math.round(P.y + (Q.y - P.y) * u0);
    const x1 = Math.round(P.x + (Q.x - P.x) * u1), y1 = Math.round(P.y + (Q.y - P.y) * u1);
    const rm = paramAt((cum[k] + cum[k + 1]) / 2);         // FULL segment midpoint (stable for partial
    let f0, f1;                                             // head/tail blocks -> no per-frame recolour)
    if (treat === 'smooth' || ribbed) { f0 = paramAt(s0); f1 = paramAt(s1); }  // ribbed body = continuous
    else if (treat === 'hard') { f0 = f1 = rm; }
    else { f0 = 0.72 * rm + 0.28 * paramAt(s0); f1 = 0.72 * rm + 0.28 * paramAt(s1); }
    const c0 = colL(f0, bodyL), c1 = colL(f1, bodyL);
    let fill;
    if (c0 === c1) fill = c0;
    else { fill = ctx.createLinearGradient(x0, y0, x1, y1); fill.addColorStop(0, c0); fill.addColorStop(1, c1); }
    let r;
    if (Math.abs(y1 - y0) < 0.5) { const X0 = Math.min(x0, x1) - h2, X1 = Math.max(x0, x1) + h2; r = [X0, y0 - h2, X1 - X0, wS]; }
    else { const Y0 = Math.min(y0, y1) - h2, Y1 = Math.max(y0, y1) + h2; r = [x0 - h2, Y0, wS, Y1 - Y0]; }
    rects.push({ r, fill, rm });
  }
  // paint in ASCENDING param order (canonical = static) — corner overlap ownership is identical
  // regardless of which direction the worm traverses the path.
  rects.sort((u, v) => u.rm - v.rm);
  for (const { r, fill } of rects) { ctx.fillStyle = fill; ctx.fillRect(r[0], r[1], r[2], r[3]); }
  if (t.legendary === 'outline') {                     // hollow it out, leaving a THIN contour stroke.
    // The contour is a CONSTANT weight tied to the CANVAS, never to the stroke width — a thick
    // riggle gets MORE negative space, not a thicker outline (S/9 scaled with the piece, so big
    // chunky pieces rendered fat contours, and the 2px floor made thumbnails disagree with the
    // square view). ~1px per 240px of canvas = the hairline QA reference look at every size.
    const md = Math.min(ctx.canvas.width, ctx.canvas.height);
    const k = Math.max(1, Math.round(md / 240));         // k IS the contour weight (hole inset)
    // On a transparent field there is no background colour to paint the hollow with, so it is
    // CUT out of the stroke instead (destination-out), which reads identically on any host.
    const cut = bgCol === 'transparent';
    if (cut) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; }
    ctx.fillStyle = cut ? '#000' : (bgCol || '#000');
    for (const { r } of rects) if (r[2] > 2 * k && r[3] > 2 * k) ctx.fillRect(r[0] + k, r[1] + k, r[2] - 2 * k, r[3] - 2 * k);
    if (cut) ctx.restore();
  }
}

// opts: bg · circleSafe · colorPhase (0..1 hue drift) · anim (0..1 loop pos; null = static)
export function drawRiggle(ctx, t, W, H, opts = {}) {
  const { colorPhase = 0, circleSafe = true } = opts;
  let anim = opts.anim == null ? null : opts.anim;
  const { TI, TH } = restOf(t);                     // Inverted / Smoky rest in their own window
  // smoke: 1.5x loop with hold fraction shrunk so the COLOUR CYCLE runs at the standard absolute
  // speed (0.2267 * 1.5 = 0.34) - only the crawl is slower (~1.76x), where the vapor lives.
  // Churn IGNITION envelope: amplitude 0 exactly at the loop entry point (the click frame -
  // first anim frame == the static, no jar), easing in just after, easing back to 0 as the worm
  // re-lands each loop. Full amplitude everywhere else, incl. across the hold-exit boundary.
  const sE = t.path === 'orbit' ? 0.66 : TI;
  // Smoke's loop entry is exact: the click (and every landing) computes the loop phase as
  // (phase * loop % loop) / loop, which can come back a hair BELOW sE and draw the last crawl
  // frame instead of the parked still. Within 1e-9 of sE it IS sE.
  if (t.smoke && anim != null && Math.abs(anim - sE) < 1e-9) anim = sE;
  // Both ramps are smoothstepped: a linear ramp started and stopped the churn's drift at full
  // speed, a visible kick in every puff the frame the riggle lands and the frame it wakes.
  const sStep = (x) => x * x * (3 - 2 * x);
  const sAmp = !t.smoke || anim == null ? 0
    : anim >= sE && anim < sE + 0.06 ? sStep((anim - sE) / 0.06)
    : anim >= sE - 0.05 && anim < sE ? sStep((sE - anim) / 0.05)
    : 1;
  // INVERTED — the banner mechanic (riggles-loop-solo.mp4), per QA redesign: HARD two-tone, no
  // gradients. bg = the piece's ANCHOR colour, riggle = its photo-NEGATIVE (complement hue,
  // flipped lightness; greyscale = value inversion). During the hold a straight wipe front
  // slides across (direction = the path trait) and everything behind it swaps polarity.
  // FLIPS = 2 passes per hold: base -> negative -> base, so phase 0 and 1 are the exact static.
  // Composited from two full-polarity layers (_inv 1 = base, _inv 2 = swapped) + a clip rect.
  if (t.legendary === 'inverted' && !opts._inv && typeof document !== 'undefined') {
    let ph = 0;
    if (anim == null) ph = ((colorPhase % 1) + 1) % 1;
    else if (t.path === 'orbit') ph = anim >= 0.66 ? (anim - 0.66) / 0.34 : 0;
    else ph = anim >= TI && anim < TI + TH ? (anim - TI) / TH : 0;
    if (ph >= 1) ph = 0;
    // HOLD TIMELINE (QA retune - "slide, beat, slide, beat, slide"): three eased passes with a
    // FULL BEAT resting on each landed schema between them, and a longer rest at the end before
    // the crawl. Passes are quintic-eased - slow launch, fast middle, hard brake = weight.
    // THREE passes walk THREE schema states: start -> negated -> palette-shifted -> back home.
    //   pass1 0-.18 | beat .18-.28 | pass2 .28-.46 | beat .46-.56 | pass3 .56-.74 | rest .74-1
    const FLIPS = 3;
    let k, f;
    if (ph < 0.18) { k = 0; f = ph / 0.18; }
    else if (ph < 0.28) { k = 0; f = 1; }
    else if (ph < 0.46) { k = 1; f = (ph - 0.28) / 0.18; }
    else if (ph < 0.56) { k = 1; f = 1; }
    else if (ph < 0.74) { k = 2; f = (ph - 0.56) / 0.18; }
    else { k = 2; f = 1; }
    f = f < 0.5 ? 16 * f * f * f * f * f : 1 - Math.pow(-2 * f + 2, 5) / 2;
    const layer = (pol) => { const off = document.createElement('canvas'); off.width = W; off.height = H; drawRiggle(off.getContext('2d'), t, W, H, { ...opts, _inv: pol + 1, _invPh: ph }); return off; };
    ctx.drawImage(layer(k % FLIPS), 0, 0);
    if (f > 0) {
      // HORIZONTAL only, alternating direction, and pass 1 runs OPPOSITE the riggle's travel
      // direction (an LR riggle gets an RL first wipe). Vertical wipes were cut in QA.
      const rl = t.path === 'RL' ? k % 2 === 1 : k % 2 === 0;
      ctx.save(); ctx.beginPath();
      if (rl) ctx.rect(W - f * W, 0, f * W, H);
      else ctx.rect(0, 0, f * W, H);
      ctx.clip(); ctx.drawImage(layer((k + 1) % FLIPS), 0, 0); ctx.restore();
    }
    return;
  }
  const bg = opts.bg == null ? t.bgBit : opts.bg;
  const g = buildGeom(t, W, H, circleSafe);
  const { V, S, wS } = g;
  const bgCol = typeof bg === 'string' ? bg : PALETTE[bg];  // ribbed slices the tube with this -> colour ribs
  // 'transparent' is the embed's option (riggles.xyz/embed.js): the host page shows through, so
  // every frame starts from a cleared canvas instead of a painted field. Inverted ignores it:
  // its field IS the art, and it paints its own layers above.
  if (bg === 'transparent') ctx.clearRect(0, 0, W, H);
  else { ctx.fillStyle = bgCol; ctx.fillRect(0, 0, W, H); }
  ctx.save();
  ctx.translate(g.originX, g.offsetY);
  ctx.lineJoin = 'miter'; ctx.miterLimit = 8;

  const startC = (t.startColor + colorPhase * 255) % 255;
  const spanK = COLORSPAN / t.spreadEff, greyK = COLORSPAN / t.spreadEff;
  // sc = hue-offset byte. smooth uses startC (global drift); hard rotates the run param instead.
  const wrap = (v) => ((v % 255) + 255) % 255;             // wrap hue byte (params can run past [0,1])
  // grey floor kept well above black so a stroke is NEVER a background colour (black or volt) -> always visible
  const colorWith = (tt, sc, L) => { const lf = L == null ? 1 : L / 50; if (t.spectrum === 'grey') { const v = wrap((tt * greyK) + sc); return 'hsl(0,0%,' + (38 + ((t.reverse ? 255 - v : v) / 255) * 54) * lf + '%)'; } let h = wrap((tt * spanK) + sc); if (t.reverse) h = 255 - h; return 'hsl(' + (h / 255) * 360 + ',' + t.satPct + '%,' + clamp((L == null ? 50 : L) * t.lightMul, 12, 88) + '%)'; };
  let colorAt = (tt) => colorWith(tt, startC);
  // LEGENDARY overrides — rare inversions of how the piece is drawn, not another colourway
  if (t.legendary === 'inverted') {                    // one polarity LAYER of the wipe composite:
    // anchor colour (fixed — the wipe replaces hue cycling) and its photo-negative.
    // The riggle keeps its FULL rolled palette; INVERSION is a photo-negative applied per colour
    // (complement hue, flipped lightness - greyscale flips value). Base polarity: bg = anchor,
    // riggle = negated palette. Swapped: bg = negated anchor, riggle = the ORIGINAL palette.
    // L-channel structure (ribs, ring shading, pixel variance) flows through colorWith as usual.
    const hslP = (css) => /hsl\(([-\d.]+),([\d.]+)%,([\d.]+)%\)/.exec(css);
    const inv = (css) => { const mm = hslP(css); return 'hsl(' + ((+mm[1] + 180) % 360) + ',' + mm[2] + '%,' + clamp(100 - +mm[3], 8, 92) + '%)'; };
    const rot = (css, deg, flipL) => { const mm = hslP(css); return 'hsl(' + ((+mm[1] + deg) % 360) + ',' + mm[2] + '%,' + (flipL ? clamp(100 - +mm[3], 8, 92) : +mm[3]) + '%)'; };
    // Three schema states. BACKGROUNDS form a fixed CONTRAST TRIAD (QA: mid-sweep bg was a
    // near-shade of the anchor on family pieces, and matched the complement on rainbow pieces):
    //   0 start:  bg = anchor colour              riggle = negated palette
    //   1 invert: bg = anchor + 180deg, L flipped  riggle = the ORIGINAL palette
    //   2 shift:  bg = anchor + 120deg             riggle = negated palette shifted by half
    // Greyscale bgs pick the two most distant values from {12,50,88} instead of hue rotations.
    // The RIGGLE PALETTE HUE-CYCLES one full wheel across the hold (_invPh) while the swipes
    // run - it wraps to exactly the static palette at both hold ends, so nothing pops.
    const st = opts._inv - 1;
    const anchor = colorWith(0, t.startColor);
    let bgc;
    if (t.spectrum === 'grey') {
      const L0 = +hslP(anchor)[3];
      const cand = [12, 50, 88].sort((a, b) => Math.abs(b - L0) - Math.abs(a - L0));
      bgc = st === 0 ? anchor : 'hsl(0,0%,' + (st === 1 ? cand[0] : cand[1]) + '%)';
    } else {
      bgc = st === 0 ? anchor : st === 1 ? rot(anchor, 180, true) : rot(anchor, 120, false);
    }
    ctx.fillStyle = bgc;
    ctx.fillRect(-g.originX, -g.offsetY, W, H);
    const scPh = (t.startColor + (opts._invPh || 0) * 255) % 255;
    colorAt = st === 0 ? (tt, L) => inv(colorWith(tt, scPh, L))
            : st === 1 ? (tt, L) => colorWith(tt, scPh, L)
            : (tt, L) => inv(colorWith(tt + 0.5, scPh, L));
  } else if (t.legendary === 'duotone') {              // two hard hues, no gradient at all
    // duotone keeps the LIGHTNESS channel: accordion's dim body + bright rib stroke (and any
    // other L-based structure) still reads - only the HUE hardens to two values. Flattening L
    // filled accordions into solid tubes with botched stamp corners (QA, 3 flagged hashes).
    colorAt = (tt, L) => colorWith(tt < 0.5 ? 0.12 : 0.88, startC, L);
  }

  const cumW = cumOf(V), waveLen = cumW[cumW.length - 1] || 1;

  if (anim == null) {
    drawSpan(ctx, V, cumW, 0, waveLen, t, S, wS, (tt, L) => (t.legendary === 'inverted' || t.legendary === 'duotone') ? colorAt(tt, L) : colorWith(tt, startC, L), (s) => s / waveLen, bgCol, 0, 1, colorPhase % 1);
    ctx.restore();
    return;
  }

  if (t.path === 'orbit') {
    // ORBITAL: the WORM CRAWL on a closed circuit INSIDE the canvas. anim 0 = riggle formed at
    // centre. The head then crawls off along a square-wave tour of the canvas interior (down or up
    // per the last riser, around the frame lanes, zigzagging the long legs), body flowing behind —
    // and re-lays the signature back at centre. Rest -> colours cycle -> repeat. Same worm window
    // mechanic as the other paths; the path just never leaves the canvas.
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const v of V) { if (v.x < xmin) xmin = v.x; if (v.x > xmax) xmax = v.x; if (v.y < ymin) ymin = v.y; if (v.y > ymax) ymax = v.y; }
    // exact half-extent per type so the stroke sits FLUSH on the canvas edge (no gap):
    const hb = t.slinky ? (S * 1.5 * (t.pipe ? 1.12 : 1)) / 2 : wS / 2;
    // lanes ON the walls: the zigzag base rides each wall and dips INWARD, so the worm taps the wall
    // over and over (bounce), and rides the left/right walls on the vertical legs -> all 4 sides.
    const XL = Math.round(-g.originX + hb), XR = Math.round(W - g.originX - hb);
    const YT = Math.round(-g.offsetY + hb), YB = Math.round(H - g.offsetY - hb);
    const V0 = V[0], Vn = V[V.length - 1];
    const goDown = Vn.y >= V[V.length - 2].y;              // continue the last riser's direction
    // (y grows downward: an end BELOW its neighbour points down, so the tour keeps going down.
    //  The old <= sent an up-pointing end down over its own riser - QA, Cap 2026-09-01.)
    const amp = Math.round(S * 1.4), runL = S * 2;
    const zig = (fromX, toX, y, dip) => {                   // square-wave along a wall, dipping inward
      const out = [], dir = Math.sign(toX - fromX); let x = fromX, lvl = 0;
      while (Math.abs(toX - x) > runL * 2.2) { x += dir * runL; out.push({ x, y: y + lvl }); const nl = lvl === 0 ? dip * amp : 0; out.push({ x, y: y + nl }); lvl = nl; }
      out.push({ x: toX, y: y + lvl }); if (lvl !== 0) out.push({ x: toX, y });
      return out;
    };
    const tour = [];
    const lane1 = goDown ? YB : YT, dip1 = goDown ? -1 : 1;  // dip inward from the wall
    const lane2 = goDown ? YT : YB, dip2 = goDown ? 1 : -1;
    // Leave the signature at a right angle, never back over it: step one run length
    // clear of the final riser FIRST, then drop to the wall lane. A straight drop at
    // Vn.x retraced the last riser whenever it stood vertical (QA, Cap 2026-09-01).
    const outX = Math.min(XR, Vn.x + runL);
    tour.push({ x: outX, y: Vn.y });                        // right-angle out, clear of the body
    tour.push({ x: outX, y: lane1 });                       // then down (or up) to the first wall
    tour.push(...zig(outX, XR, lane1, dip1));               // bounce along it to the right wall
    tour.push({ x: XR, y: lane2 });                         // ride the right wall
    tour.push(...zig(XR, XL, lane2, dip2));                 // bounce along the far wall to the left
    tour.push({ x: XL, y: V0.y });                          // ride the left wall to the start height
    // then straight in to V0 -> the head re-lays the signature
    const pts = [...V.map((v) => ({ x: v.x, y: v.y })), ...tour, ...V.map((v) => ({ x: v.x, y: v.y }))];
    const cum = cumOf(pts), total = cum[cum.length - 1], DL = waveLen;
    const TRAVEL = 0.66;
    let b, cyc2 = 0;
    if (anim < TRAVEL) b = DL + (total - DL) * trap(anim / TRAVEL);
    else { b = total; cyc2 = (anim - TRAVEL) / (1 - TRAVEL); }   // landed centre -> colour cycle
    const sc2 = (t.startColor + cyc2 * 255) % 255;
    if (anim >= TRAVEL) {                                  // REST = the static pipeline verbatim
      drawSpan(ctx, V, cumW, 0, waveLen, t, S, wS, (tt, L) => (t.legendary === 'inverted' || t.legendary === 'duotone') ? colorAt(tt, L) : colorWith(tt, sc2, L), (s) => s / waveLen, bgCol, 0, 1, cyc2 % 1, 1, anim, sAmp);
      ctx.restore();
      return;
    }
    const segAvgO = waveLen / Math.max(1, V.length - 1);   // faceted/stamped: snap whole segments,
    const facetedO = t.treatment !== 'smooth' || t.slinky || t.ribbed || t.fuzzy;  // anchored to TOTAL (rest pos)
    const snapO = () => facetedO ? total + Math.round((b - total) / segAvgO) * segAvgO : b;
    const paramO = (s) => { const bC = snapO(); return clamp((s - (bC - DL)) / DL, 0, 1); };
    // Smoke fades (head fade-in, tail dissipation) ramp at BOTH ends of the tour:
    // zero at launch so the first travel frame is the colour-cycle frame exactly
    // (the leading-edge jump QA caught), zero at landing so the last one is too.
    // With position-seeded puffs no anchor glide exists to read as acceleration.
    const smokeMfO = () => Math.min(clamp((b - DL) / (S * 3), 0, 1), clamp(Math.abs(total - b) / (S * 3), 0, 1));
    drawSpan(ctx, pts, cum, b - DL, b, t, S, wS, (tt, L) => (t.legendary === 'inverted' || t.legendary === 'duotone') ? colorAt(tt, L) : colorWith(tt, sc2, L), paramO, bgCol, t.smoke ? 0 : snapO() - DL, 1, t.fuzzy ? anim / TRAVEL : cyc2 % 1, t.smoke ? smokeMfO() : 1, anim, sAmp, total - DL, { pts: V, cum: cumW });
    ctx.restore();
    return;
  }

  // ---- WORM crawl (banner mechanic): the trait direction is HONEST — the worm enters from the
  // trait's entry edge and exits out the trait's exit edge, always. If the signature's end section
  // doesn't face the exit direction, it takes a 90-degree ELBOW at the endpoint and goes straight
  // out (Cap's rule). A wrong-facing vertical end (e.g. TB piece whose last riser points up) gets a
  // small square HOOK (riser -> sidestep -> out). Entry mirrored. All turns stay 90 degrees.
  const nrm = (dx, dy) => { const m = Math.hypot(dx, dy) || 1; return [dx / m, dy / m]; };
  const rev = t.path === 'RL' || t.path === 'BT';
  const seq = rev ? V.slice().reverse().map((v) => ({ x: v.x, y: v.y })) : V.map((v) => ({ x: v.x, y: v.y }));
  const I = { LR: [1, 0], RL: [-1, 0], TB: [0, 1], BT: [0, -1] }[t.path];   // travel direction
  const P0 = seq[0], P1 = seq[1], Pn = seq[seq.length - 1], Pm = seq[seq.length - 2];
  const dS = nrm(P1.x - P0.x, P1.y - P0.y), dE = nrm(Pn.x - Pm.x, Pn.y - Pm.y);
  const LEADLEN = W + H + waveLen, jog = S * 2.2;
  // subdivide the leads into signature-sized chunks so the palette keeps flowing along them
  const segLen = Math.max(g.S, waveLen / Math.max(1, V.length - 1));
  const polyExpand = (poly) => { const out = []; for (let i = 0; i + 1 < poly.length; i++) { const a = poly[i], c = poly[i + 1]; const d = Math.hypot(c.x - a.x, c.y - a.y), n2 = Math.max(1, Math.ceil(d / segLen)); for (let j = 1; j <= n2; j++) out.push({ x: Math.round(a.x + (c.x - a.x) * j / n2), y: Math.round(a.y + (c.y - a.y) * j / n2) }); } return out; };
  // ENTRY polyline (ends at P0), approaching along I; hook if the start faces against the travel dir
  let inPoly;
  if (I[0] * dS[0] + I[1] * dS[1] < -0.5) { const A1 = { x: P0.x + jog, y: P0.y }; inPoly = [{ x: A1.x - I[0] * LEADLEN, y: A1.y - I[1] * LEADLEN }, A1, P0]; }
  else inPoly = [{ x: P0.x - I[0] * LEADLEN, y: P0.y - I[1] * LEADLEN }, P0];
  // EXIT polyline (starts at Pn), leaving along I; hook if the end faces against the travel dir
  let outPoly;
  if (I[0] * dE[0] + I[1] * dE[1] < -0.5) { const B1 = { x: Pn.x + jog, y: Pn.y }; outPoly = [Pn, B1, { x: B1.x + I[0] * LEADLEN, y: B1.y + I[1] * LEADLEN }]; }
  else outPoly = [Pn, { x: Pn.x + I[0] * LEADLEN, y: Pn.y + I[1] * LEADLEN }];
  const leadIn = [inPoly[0], ...polyExpand(inPoly).slice(0, -1)];   // points before P0 (travel order)
  const leadOut = polyExpand(outPoly);                               // points after Pn
  const pts = [...leadIn, ...seq, ...leadOut];
  const sigA = leadIn.length, sigB = leadIn.length + V.length - 1;
  const cum = cumOf(pts), A = cum[sigA], B = cum[sigB], DL = B - A, total = cum[cum.length - 1];
  // NOT clamped: leads get param <0 / >1 so the colour palette continues along them (sections flow out).
  // colour param is relative to the WORM'S MOVING WINDOW [b-DL, b], not the fixed path — so the
  // paint is glued to the body: colour sections travel WITH the riggle as it crawls (same length,
  // nothing stretches or eats its own tail). At the hold b === B, so the window equals the
  // signature and the colours land EXACTLY on the static image. Bounded [0,1] -> no palette
  // wrapping on the leads. FACETED treatments snap the colour reference in WHOLE-SEGMENT steps
  // (bC): the coloured chunks jump block-to-block as it crawls — staying segmented, readable rate —
  // instead of recolouring every frame (the hyper strobe). Snap is zero at the hold -> lands exact.
  const segAvg = waveLen / Math.max(1, V.length - 1);
  const faceted = t.treatment !== 'smooth' || t.slinky || t.ribbed || t.fuzzy;  // snap for anything block/stamp based
  const snapB = () => faceted ? B + Math.round((b - B) / segAvg) * segAvg : b;
  const paramAt = (s) => { const bC = snapB(); const p = clamp((s - (bC - DL)) / DL, 0, 1); return rev ? 1 - p : p; };

  // COLOUR matches the static exactly during entry/exit (no cycling), then cycles ONE hue wheel while
  // landed at centre, then back to static for the exit. Cycling a hue OFFSET (not param) keeps it
  // controlled — hyper/full-spectrum no longer flashes to grey.
  const cyc = anim < TI ? 0 : anim < TI + TH ? (anim - TI) / TH : 0;
  const sc = (t.startColor + cyc * 255) % 255;

  // HOLD = the STATIC pipeline, verbatim (same code path as anim==null, hue offset = the cycle).
  // Landed frame is byte-identical to the static BY CONSTRUCTION — no window-mapping drift possible.
  if (anim >= TI && anim < TI + TH) {
    drawSpan(ctx, V, cumW, 0, waveLen, t, S, wS, (tt, L) => (t.legendary === 'inverted' || t.legendary === 'duotone') ? colorAt(tt, L) : colorWith(tt, sc, L), (s) => s / waveLen, bgCol, 0, 1, cyc % 1, 1, anim, sAmp);
    ctx.restore();
    return;
  }

  // ENDS ARE EMPTY: head starts just off the entry edge, tail ends just off the exit edge. Sample along
  // the arc to find where the (long, straight) lead crosses onto / off the canvas — so no dead travel.
  const mar = wS * 2, step = Math.max(3, wS / 2);
  const ptAt = (d) => { let k = 0; while (k < pts.length - 2 && cum[k + 1] < d) k++; const u = (d - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]); return { x: pts[k].x + (pts[k + 1].x - pts[k].x) * u, y: pts[k].y + (pts[k + 1].y - pts[k].y) * u }; };
  const onS = (d) => { const p = ptAt(d), cx = p.x + g.originX, cy = p.y + g.offsetY; return cx >= -mar && cx <= W + mar && cy >= -mar && cy <= H + mar; };
  let bStart = 0; for (let s = 0; s <= total; s += step) { if (onS(s)) { bStart = Math.max(0, s - step); break; } }
  let bEnd = total + DL; for (let s = total; s >= 0; s -= step) { if (onS(s)) { bEnd = Math.min(total, s + step) + DL; break; } }

  // crawl IN (head leads in from off-screen) -> HOLD (worm covers the signature) -> crawl OUT (fully off).
  let b;
  if (anim < TI) b = bStart + (B - bStart) * trap(anim / TI);
  else if (anim < TI + TH) b = B;
  else b = B + (bEnd - B) * trap((anim - TI - TH) / (1 - TI - TH));
  // Pixelated twinkles on the crawl too: the twinkle phase runs 0 to 1 across each leg
  // (entry, then exit), integer at every boundary, so launch and landing stay the exact
  // static pattern while the pixels breathe in between.
  // Smoke: the vapor trail also dissolves over the last 3 stroke widths of the exit, so the
  // loop's wrap (exit end -> next entry) no longer cuts a visible trail off in one frame.
  const crawlPh = t.fuzzy ? (anim < TI ? anim / TI : (anim - TI - TH) / Math.max(1e-6, 1 - TI - TH)) : cyc % 1;
  drawSpan(ctx, pts, cum, b - DL, b, t, S, wS, (tt, L) => (t.legendary === 'inverted' || t.legendary === 'duotone') ? colorAt(tt, L) : colorWith(tt, sc, L), paramAt, bgCol, t.smoke ? (rev ? B : A) : (rev ? snapB() : snapB() - DL), rev ? -1 : 1, crawlPh, t.smoke ? Math.min(clamp(Math.abs(b - B) / (S * 3), 0, 1), clamp((bEnd - b) / (S * 3), 0, 1)) : 1, anim, sAmp, null, { pts: V, cum: cumW });
  ctx.restore();
}

// animation loop: responsive (sizes to container). colours cycle during the centre rest.
// loop duration scales with path length so worm SCREEN-speed is ~constant — dense pieces don't
// feel too fast/rigid, simple pieces don't crawl.
export function animateRiggle(canvas, t, opts = {}) {
  const bg = opts.bg == null ? t.bgBit : opts.bg;
  const ctx = canvas.getContext('2d');
  const loopMs = opts.loopMs || loopMsOf(t);                // one pacing, defined once below
  let raf, t0 = null;
  const frame = (now) => {
    if (t0 == null) t0 = now - (opts.phase || 0) * loopMs;
    const lp = ((((now - t0) % loopMs) + loopMs) % loopMs) / loopMs;
    const rect = canvas.getBoundingClientRect();
    const px = Math.max(64, Math.round(Math.min(rect.width || 300, rect.height || 300) * (window.devicePixelRatio || 1)));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    let colorPhase = 0; // cycles only during the centre rest
    if (lp >= T_IN && lp < T_IN + T_HOLD) colorPhase = (lp - T_IN) / T_HOLD;
    else if (lp >= T_IN + T_HOLD) colorPhase = 1;
    drawRiggle(ctx, t, px, px, { anim: lp, colorPhase, bg, circleSafe: true });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// ------------------------------------------------------------- THE WIDE LOOP
// 16:9, the collection's own view of itself. This was written twice: once in
// web/asset-studio.html's WIDE tab and once again wherever a wide riggle was
// wanted. It lives here now and the studio calls it, so a riggle on the homepage
// and a riggle in an exported banner are the same frames.
//
// drawRiggle handles a wide canvas natively: the square composition centers and
// the field extends. The crawl leads are W + H + waveLen long, so the entrance
// starts past the widescreen edge. The loop runs x1.45 longer than the square
// one because the worm covers more ground; same trapezoid, same holds.

/**
 * The engine's own pacing for a riggle, in ms: loop length scales with path length
 * (canvas-widths of path, ~1.4-4). Inverted runs 1.35x: the 3-pass schema walk needs
 * room, so beats between slides land at ~0.5-1s instead of being crushed into a 2s
 * hold. Smoky runs 1.5x: the slower crawl is what reads as smoke.
 */
export const loopMsOf = (t) => {
  const gg = buildGeom(t, 300, 300, true), cg = cumOf(gg.V);
  const ratio = (cg[cg.length - 1] || 300) / 300;
  return Math.round(clamp(3400 * ratio, 5200, 11000) * loopScale(t));
};

/** Where a loop starts: orbit rests late in its cycle, every worm path rests at its restOf(t).TI. */
export const PHASE = (t) => (t.path === 'orbit' ? 0.66 : restOf(t).TI);

/** One full widescreen loop, in ms. The carousel times itself off this. */
export const wideLoopMs = (t) => Math.round(loopMsOf(t) * 1.45);

/**
 * The widescreen animation. `seed` is a parsed riggle or its 0x hash.
 * `opts.once` draws a single resting frame instead of looping, which is what
 * prefers-reduced-motion gets. `opts.fill` sizes the canvas to its container's
 * aspect instead of 16:9. `opts.bg` may be 'transparent'. Returns a stop function.
 */
export function animateRiggleWide(canvas, seed, opts = {}) {
  const t = typeof seed === 'string' ? parseHash(seed) : seed;
  const ctx = canvas.getContext('2d');
  const bg = opts.bg == null ? t.bgBit : opts.bg;
  const loopMs = opts.loopMs || wideLoopMs(t);
  const ph = opts.phase == null ? PHASE(t) : opts.phase;
  let raf = null, t0 = null;
  const frame = (now) => {
    if (t0 == null) t0 = now - ph * loopMs;
    const lp = ((((now - t0) % loopMs) + loopMs) % loopMs) / loopMs;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(320, Math.round((rect.width || 960) * dpr));
    // opts.fill: the canvas takes its container's own aspect (the embed, which can be a whole
    // page background at any shape). Default stays the fixed 16:9 the hero and studio use.
    const pxW = pw, pxH = opts.fill ? Math.max(180, Math.round((rect.height || pw * 9 / 16 / dpr) * dpr)) : Math.round(pw * 9 / 16);
    if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
    let colorPhase = 0;
    if (lp >= T_IN && lp < T_IN + T_HOLD) colorPhase = (lp - T_IN) / T_HOLD;
    else if (lp >= T_IN + T_HOLD) colorPhase = 1;
    drawRiggle(ctx, t, pxW, pxH, { anim: lp, colorPhase, bg, circleSafe: true });
    if (opts.once) { raf = null; return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { if (raf) cancelAnimationFrame(raf); raf = null; };
}

export function renderStatic(canvas, t, W, H, opts = {}) {
  canvas.width = W; canvas.height = H;
  drawRiggle(canvas.getContext('2d'), t, W, H, { bg: opts.bg == null ? t.bgBit : opts.bg, circleSafe: opts.circleSafe !== false && W === H });
}

// The token view (Chromie mechanic): shows the STATIC riggle; click/tap toggles the animation.
// Because the landed frame is pixel-identical to the static, the loop starts FROM the hold — it
// begins seamlessly from the image being looked at (colours cycle, riggles out, loops forever).
// Click again: stops, static riggle reappears.
export function interactiveRiggle(canvas, t, opts = {}) {
  const bg = opts.bg == null ? t.bgBit : opts.bg;
  let stop = null;
  const still = () => { const r = canvas.getBoundingClientRect(); const px = Math.max(64, Math.round(Math.min(r.width || 300, r.height || 300) * (window.devicePixelRatio || 1))); canvas.width = px; canvas.height = px; drawRiggle(canvas.getContext('2d'), t, px, px, { bg, circleSafe: true }); };
  // Both start FROM their rest segment so a click cycles colours in place first, then travels,
  // and the loop ends back in a cycle — orbit's rest lives at 0.66-1.0 (TRAVEL in the orbit
  // branch), not at T_IN like the worm paths. Starting orbit at 0 skipped the in-place cycle.
  const toggle = () => { if (stop) { stop(); stop = null; still(); } else stop = animateRiggle(canvas, t, { bg, phase: PHASE(t) }); };
  const onTouch = (e) => { e.preventDefault(); toggle(); };
  canvas.addEventListener('click', toggle);
  canvas.addEventListener('touchstart', onTouch, { passive: false });
  canvas.style.cursor = 'pointer';
  // A resize while parked re-renders the still at the new size; the animation
  // loop already sizes itself every frame, so it needs nothing here.
  const onResize = () => { if (!stop) still(); };
  window.addEventListener('resize', onResize);
  still();
  return () => { if (stop) stop(); canvas.removeEventListener('click', toggle); canvas.removeEventListener('touchstart', onTouch); window.removeEventListener('resize', onResize); };
}
export function renderRiggle(canvas, hash, bg, size) {
  const t = parseHash(hash);
  canvas.width = size; canvas.height = size;
  drawRiggle(canvas.getContext('2d'), t, size, size, { bg, circleSafe: true });
}

// --- local addition (see the header): the brick builder needs the geometry ---
export { buildGeom, cumOf };
