# Squiggle to Bricks — design brief (stages 2, 3, 3 bis)

Repo: ~/Projects/squiggle-to-bricks (fork of Punk to Bricks: Vite + TS + three.js, 100% static, no server).
Everything runs in the browser; builders must also run in Node (vitest) and in a Web Worker: no DOM in
builders. TypeScript strict. Match the surrounding code style: short header comment per file, few comments,
compact code, English identifiers and UI text.

## What exists (do not break the Punk code in src/core, src/viewer, src/export: tests must stay green)

- `src/core/parts.ts` — `Piece {x,z,y,h,w,d,c,kind,part,dir?,group?,support?,nameplate?,role?}`.
  Units: x, z in studs (x right, z towards the back), y and h in plates (brick = 3 plates).
  Kinds: brick, plate, tile, slope, technic (Technic brick 1×N with holes, 3 plates tall), round
  (1×1 round: h 3 = brick 3062b, h 1 = plate 6141). `partId(kind,w,d,h)`, `partName(...)`.
  PARTS now include large plates (up to 16×16, 6×24 white only), bricks 1×12/1×16, Technic bricks 1×2…1×16.
- `src/core/tile.ts` — `tileLayer(cells: Map<key,{c,vis}>, opts)` greedy filler of one layer;
  hidden cells (vis false) may take any colour (so pieces run across colours inside), `below` forces
  pieces to rest on the layer underneath, `sizes` = allowed sizes, `allow` = filter.
- `src/core/check.ts` — `checkModel(pieces, {root?, base?})`: stud connections, floating pieces
  (not connected to the root pieces; default root = lowest pieces), collisions, weak (1-stud) pieces,
  centre of mass over the `base` pieces' bounding box. `studsBelow(pieces)`: studs engaged from below.
  Tiles and curved slopes have no studs on top (nothing connects on them).
- `src/core/palette.ts` — BrickLink colours (`COLOR_BY_ID`), Trans-Clear = 12, Black = 11, White = 1.
- `src/core/lego.ts` — `elementId(part, color)`: LEGO Element ID if sold on Pick a Brick, else null.
  Prefer parts with an Element ID (black, white, the 11 spectrum colours are well covered;
  6×24 plate exists in white only; there is no 2×8 tile: use the 2×6 tile 69729).
- `src/squiggle/source.ts` — fetch + redraw with the original p5 script (stage 1, done).
- `src/squiggle/curve.ts` — `readCurve(fixture) → Curve {id,type,spectrum,canvas,points[{x,y,hue,rib?,end?}],
  stroke,outline,ribGray,box}`; `arcLength(points)`. Canvas pixels, y down. `stroke` = diameter of the
  coloured stroke (h/13 ≈ 61.5 px for Normal; Bold 160; Fuzzy core 82). Pipe: `outline` = diameter of
  the black rings (114 px). Ribbed: `ribGray` = rib grey level (0..255), `rib` on points where a rib is drawn.
- `src/squiggle/spectrum.ts` — `SPECTRUM` (11 colours in order: Red 5, Orange 4, Yellow 3, Lime 34,
  Green 6, Dark Turquoise 39, Dark Azure 153, Blue 7, Dark Purple 89, Magenta 71, Dark Pink 47) + White 1 +
  Black 11. `curveColors(curve, minRunPx)` → colour per point, spectrum order kept, one step at a time,
  each colour at least `minRunPx` long. Use minRun = 2 studs converted to pixels.
- `src/squiggle/model.ts` — `SqModel` (the output of every builder), `summarize(pieces, pose)` for
  bom/subtotals/colors/dims/grams/cost. Every piece must set `role: 'squiggle' | 'display'`.
- `src/squiggle/partinfo.ts` — `partGrams`, `partPrice` (stub, being replaced by a researched table).
- Fixtures: `test/fixtures/squiggles/<id>.json` = `{id, hash, features, width, height, dots}` for the
  11 test Squiggles: 0, 1, 1234, 3784, 7583, 9999 (spec) + 102 Bold, 1000 Slinky, 1004 Fuzzy, 10 Ribbed,
  1047 Pipe. `readCurve(json)` works on them directly.

## Decisions already taken by the user (do not change)

- Pipe/Ribbed black parts: rendered in black like the original (vanish on the black Mosaic: accepted).
  Ribbed ribs: black if ribGray < 128, else white. Slinky has no black: solid colour ribbon.
- Fuzzy: a slightly wider solid core (no scattered pieces).
- Bold: wider ribbon (~7 studs on the small Frame). Normal/Slinky/Ribbed ribbon = 3 studs, Fuzzy = 4,
  Pipe = 3-stud colour core + 1 black stud each side (5 total).
- Large Frame (64×32): the ribbon stays 3 studs wide (the Squiggle is drawn bigger, stroke stays 3).
- Floating/Backdrop: the ribbon lies flat; the socle grows in width (48/64/80) AND depth (24/32/40/48)
  to fit the ribbon with its margins. Never squash the ribbon.
- All three displays use the SAME ribbon (same pieces, translated) for a given Squiggle and scale.
- Frame is the default display. Page order: Frame, Floating, Backdrop.

## Coordinates for flat pictures

The picture is built lying flat, y up. Image x → model x (right). Image y (down) → model z with the
image TOP at the largest z (back): z = zOffset + (box.y1 − y)·k. Seen from the front at a plunge, or hung
(Frame: pose 'wall', z becomes up), it reads the right way round.

## Stage 2 — Mosaic (`src/squiggle/mosaic.ts`, `buildMosaic(curve, scale, meta) → SqModel`)

- Flat picture on black: grid 96×48 (large) or 64×32 (small), 1 stud = 1 cell. Fit the Squiggle
  (centre line + stroke) with ≥ 2 studs margin, keep its proportions, centred. Stroke drawn at its true
  proportion (Bold wide, Fuzzy core 4/3 of normal, Pipe: black rings invisible on black so only the colour
  core shows, Ribbed: rib bands 1 stud long every 2 studs of arc length, black/white).
- Cell colour = colour of the LAST drawn curve point whose stroke disc covers the cell centre
  (later points are on top), colours from `curveColors`. Everything else black.
- Pieces: base layer of black plates (largest available, e.g. 16×16), top layer of TILES covering every
  cell (colour + black background), merged into the largest tiles the colour allows (1×N, 2×N).
  The base plate seams must be bridged: every seam between two base plates is crossed by top tiles along
  at least half of its length, and 0 floating. No 1×1 tile where a larger one fits the colour region.
- role: coloured tiles 'squiggle'; base plates and black background tiles 'display'.
- Steps: base plates, then the tile layer in bands (e.g. 8 rows per step, bottom to top) so the booklet
  has readable steps.
- pose 'table'. Checks: 0 collisions, 0 floating. `rules`: seam bridging, grid size, margins.

## Stage 3 — Ribbon (`src/squiggle/ribbon.ts`, `buildRibbon(curve, scale) → Ribbon`)

The Relief ribbon, shared by the three displays. Output: pieces with y = 0 at the ribbon bottom,
x, z ≥ 0, plus metadata (footprint cells, end cells, bottom cells, per-cell stack height, the centre line
in studs with arc length, colour per point, ribbon width, scale k px→studs).

- Scale: fit the ribbon (centre line + ribbon width) inside the Frame panel with ≥ 4 studs margin left and
  right and ≥ 1 stud top and bottom: small panel 48×24, large 64×32. k = the largest scale that fits
  (small: also k ≤ 3/stroke(Normal) so a Normal stroke is never drawn wider than 3 studs).
- Ribbon width in studs: Normal/Slinky/Ribbed 3, Fuzzy 4, Bold 7, Pipe 5 (3 colour + 1 black each side).
  Cells = stud cells whose centre is within width/2 of the centre line (rasterise discs along the line at
  ≤ 0.25 stud spacing). Clean up: remove cells with < 2 ribbon neighbours (no single-cell spurs).
- Passes and steps (the "stepped" look, no overhang): walk the curve in drawing order; a cell touched
  again by a point far away along the curve (arc distance > 2×width since it was last touched) gets a new
  slab ON TOP (stack height +1). Slab = 3 plates. Each slab of a cell rests on the slab below of the same
  cell, so nothing overhangs. The top colour is the latest pass (later is on top, like the drawing);
  lower slabs keep their own colours (visible on the ribbon's sides).
- Colours: `curveColors(curve, 2 studs)`; Pipe edge cells black; Ribbed rib bands (1 stud long every
  2 studs of arc length) black/white across the full width.
- Layers: each slab = plate, plate, top. Top = TILE where nothing is stacked above the cell, PLATE where a
  slab sits on it (so the upper slab clicks on studs). Smooth tiled top is the default look; also support
  `studs: true` option (top = plates everywhere) so both looks can be shown to the user.
- Tiling per layer with `tileLayer`: alternate direction per layer, `below` = cells of the layer under
  (so pieces rest on it), visible cells = top layer + cells on the edge of their layer; hidden cells are
  wildcards. Stagger joints between the 3 layers of a slab (the ribbon must be one rigid laminated body).
- NO 1×1 pieces in the ribbon, and every ribbon piece must be held by ≥ 2 studs from below when the
  ribbon sits on a full panel (Frame). If a single colour cell cannot be paired, recolour it to its
  neighbour's colour (tiny fidelity loss) and re-tile; loop until no 1×1 remains.
- All ribbon pieces role 'squiggle'.

## Stage 3 bis — Displays (`src/squiggle/display.ts`, `buildRelief(curve, display, scale, meta) → SqModel`)

`meta` = `{ id, hash }` (for the nameplate). Nameplate text (2×6 black tile 69729, white text):
line 1 "Chromie Squiggle #1234", line 2 "Snowfro · Art Blocks · 2020 · 0x" + first 8 hex chars of the hash.
Nameplate piece: `nameplate: true`, role 'display'.

### Frame (default)
- White panel W×H = 48×24 (small) / 64×32 (large); ribbon centred on it (the `buildRibbon` fit).
- Frame: black, 2 studs wide all around, outside the white panel → outer (W+4)×(H+4).
- Layer y=0: black backing plates over the whole outer area (large plates).
- y=1: white plates on the panel area (joints staggered against the backing's), and the frame on the
  2-stud ring: two rows of black Technic bricks 1×N (y=1..4), joints staggered against the layers below.
- y=4: frame cap = black tiles 2×N over the ring (tie both Technic rows), the 2×6 nameplate tile at the
  bottom-right of the frame (bottom = smallest z).
- Ribbon on the white panel: ribbon y=0 → model y=2.
- Back: 4 black Technic bricks 1×2 (3700) under the backing (y = −3..0), long side along z so the pin hole
  axis is along x (parallel to the wall): the two near the top corners are the hanging points (a picture
  cord goes through both holes), the two near the bottom corners are spacers so it hangs flat.
- `hanging.points` = the 2 top bricks, `hanging.advice` = the fixing to use for the weight (e.g. under 1 kg:
  picture cord + one picture hook; 1–3 kg: cord + two hooks or a screw with wall plug; above: two screws
  with plugs), one or two short sentences. Root for checks = the backing plates. COM check not relevant
  (comInside null). twoStud = ribbon pieces with studsBelow < 2 (must be 0). pose 'wall'.
- rules: panel size, margins ≥ 4 left/right, frame closed, 2 hanging points.

### Floating
- Black socle, 2 plates thick: y=0 plates (large), y=1 black tiles over everything except where supports
  stand (and the nameplate is one of those tiles). Tiles must bridge every seam between socle plates.
- Socle size: width 48, 64 or 80, depth 24, 32, 40 or 48 — the smallest that leaves ≥ 4 studs left/right
  and ≥ 3 studs front/back around the ribbon footprint.
- Ribbon raised 6 plates above the socle top (socle top y=2 → ribbon bottom y=8) on Trans-Clear supports:
  round 1×1 plate 6141 in the tile hole (y=1..2) + 2 round 1×1 bricks 3062b (y=2..8).
  One support every 6–8 studs along the ribbon's centre line, and one under each end of the ribbon;
  each support under a cell of the ribbon's bottom layer (stack slab 0). support: true, role 'display'.
- Nameplate 2×6 centred in the front margin.
- COM over the socle (comInside). rules: support spacing ≤ 8 studs along the line, both ends supported,
  margins, socle seams bridged.
- Steps: socle, supports (listed at the end of the step as "hidden supports"), ribbon layer by layer,
  nameplate. pose 'table'.

### Backdrop
- Everything of Floating, plus a white wall at the back: width = socle width, 24 studs high (= 60 plates =
  20 courses of white 1×N bricks, running bond), 1 brick (1 stud) thick, standing on the socle's plate
  layer (no tile under it), 2 studs behind the ribbon's back edge. Two hidden braces behind the wall
  (stepped stacks of black bricks tied into the wall's lower courses by bricks spanning both rows),
  invisible from the front. The socle is deep enough for gap + wall + braces.
- `stepNotes`: a "Lighting notes" line on the wall step: where an LED strip can go (under the socle's
  front edge or along the back of the wall), no electrical part in the list.
- COM over the socle. pose 'table'.

## Build steps and notes
- `steps` must cover every piece exactly once, in a buildable order (a piece's supports are placed in
  the same or an earlier step). Hidden supports: `stepNotes[step] = 'Hidden supports: …'`.
- `notes`: human sentences for anything notable (e.g. "3 cells recoloured to avoid single studs").

## Performance
Every builder: < 1.5 s in Node on a laptop for the large scale (phones are ~5–8× slower; budget 15 s).

## Tests (vitest, test/squiggle-*.test.ts)
For the 11 fixtures × formats/displays × both scales: 0 collisions, 0 floating, twoStud 0 (Frame),
comInside true (Floating/Backdrop), all rules ok, every piece has role, steps cover all pieces once,
every part has an Element ID or is noted.
