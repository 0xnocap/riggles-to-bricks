# Squiggle to Bricks — stage 4 brief (page + exports)

Read docs/DESIGN-squiggle.md first (models, coordinates, decisions). Stages 1–3 bis are done:
`src/squiggle/{source,curve,spectrum,model,mosaic,ribbon,display,stage,nameplate,partinfo}.ts`,
fixtures in test/fixtures/squiggles, independent checker `scripts/verify-squiggle.ts`,
sheets `scripts/sheet-squiggle.cjs`, test page `stage.html`.

The repo is a fork of Punk to Bricks (a finished, public site: https://hs7j4yk4sz-boop.github.io/punk-to-bricks/).
Its page (index.html, src/main.ts, src/style.css) and exports (src/export/*, src/viewer/*) are the model to
follow: same three-section layout, same quality bar, same order flow and disclaimers. This fork becomes a
Squiggle-only site: Punk-only UI, assets and modules go away at integration (shared src/core modules stay).

## Decisions already taken by John (do not change)
- UI in English. Never "LEGO" or its logo as a product name (say "bricks"); "Buy at LEGO" button is fine.
- Title "Squiggle to Bricks". Subtitle "Build your Chromie Squiggle with real bricks. Free, unofficial, personal use."
- Credits: "Chromie Squiggle by Snowfro / Art Blocks. Made by John Karp. Inspired by @victormustar's Microduck."
  (@victormustar links to https://x.com/victormustar).
- Footer must say: unofficial; not affiliated with Art Blocks, the LEGO Group or BrickLink; models are
  computer-checked, not physically built; personal use only, no sale. Plus "LEGO® is a trademark of the LEGO
  Group", "Parts data: Rebrickable", links Disclaimer · MIT License · Source (github.com/hs7j4yk4sz-boop/squiggle-to-bricks).
- MIT license (John Karp). DISCLAIMER.md adapted (Art Blocks instead of CryptoPunks).
- Formats: Relief (default) and Mosaic. Relief displays in this order: Frame (default), Floating, Backdrop —
  one thumbnail each with its piece count and size in cm, one click to switch. Relief sizes: Large 64×32
  (default) / Small 48×24. Mosaic sizes: 96×48 (default) / 64×32. Ribbon top: smooth tiles (default).
- The main 3D render, the video and the share image default to Frame, seen from the front, hung on a light
  grey wall with a soft shadow. If the visitor picks another display/format, they follow that choice.
- Show piece count, size in cm, estimated weight and an order-of-magnitude cost ("≈ €113", labelled as an
  estimate of Pick a Brick prices). Parts list split into "Squiggle" and "Display" subtotals.
- The "Before you order" dialog with the "I understand" checkbox stays exactly as in Punk to Bricks.

## Input and fallbacks (spec)
"Squiggle #" field (0–9999). Fetch the token from Art Blocks' public API and redraw it with the original p5
script (done: source.ts). If blocked, fall back to the token's static image, then as a last resort to a user
upload. Show the original Squiggle next to the brick result. Chain to implement:
1. `script`: token JSON + generator script → sandboxed p5 redraw → recorded dots (current path).
2. `port`: token JSON OK but the generator/p5 fails → a faithful TypeScript port of the Squiggle script
   (hash → the same circles, same order; src/squiggle/port.ts) draws the dots and the original picture.
   Must match the recorded fixtures (positions within 0.5 px, same colours) for all fixtures.
3. `image`: token JSON fails → the static image at the deterministic media URL
   (https://media-proxy.artblocks.io/1/0x059edd72cd353df5106d2b9cc5ab83a52287ac3a/<id>.png, CORS *) →
   curve read from the picture (src/squiggle/fromImage.ts: background from the corners, stroke pixels,
   centre line ordered by hue along the spectrum, stroke width from the distance transform).
4. `upload`: everything fails → message + "Upload an image of your Squiggle" → same image reader.
   Paths 3–4 say in the notes that the variant details are approximate.
Test hook: `?fail=token,generator` (comma list) forces failures so every path can be tested.

## Module contracts (stage 4)
- `src/squiggle/load.ts`:
  `loadSquiggle(id, o?: {fail?: string[]}): Promise<Loaded>`, `loadUpload(file: Blob): Promise<Loaded>`,
  `interface Loaded { id: number | null; hash: string | null; features: Record<string, string|number>;
   origin: 'script'|'port'|'image'|'upload'; original: string /* image URL or data URL shown as "Original" */;
   source: CurveSource /* feed readCurve */ | null; curve: Curve; notes: string[] }`.
  Errors: throw `SourceError` with a short human message.
- `src/squiggle/worker.ts` (+ small client `src/squiggle/builder.ts`): builds models off the main thread:
  `buildAll(loaded) → { relief: Record<Scale, Record<Display, SqModel>>, mosaic: Record<Scale, SqModel> }`
  lazily per request `{format, display, scale}`; caches.
- `src/squiggle/timeline.ts`: build animation timeline for an SqModel (steps → piece drop times), like
  src/viewer/timeline.ts; `src/squiggle/stage.ts` gains an interactive mode (OrbitControls, damping,
  auto-rotate off for Frame, reset view) and the build animation (`play()`, `skip()`, `pose(t)`), used by the
  page and the video. Frame: pieces arrive onto the hung panel from the viewer's side.
- `src/squiggle/booklet.ts`: `class SqPageMaker { total; label(n); page(n): Promise<HTMLCanvasElement> }` and
  `makeBooklet(m, loaded, onProgress) → Promise<Blob>` (jsPDF, lazy-loaded). Landscape pages like Punk's.
  Pages: cover (original Squiggle + finished model render + name + figures), parts inventory (Squiggle then
  Display, with subtotals, weight, size, cost estimate note), one page per build step (3D view, new pieces
  highlighted, the step's parts with coloured part icons and counts, the step's `stepNotes` e.g.
  "Hidden supports: …" or "Lighting notes: …"), for Frame a "Hanging" page (back view with the two hanging
  points highlighted, cord through both holes, fixing advice from `m.hanging.advice` and the weight), a
  "Nameplate" page (print it at real size 47.8 × 15.8 mm with cut marks, or have it engraved), last page
  (finished model + disclaimer lines). Part icons for new kinds (Technic brick with holes, round 1×1, large
  plates). Own step renderer in src/squiggle/stepRender.ts (may import src/viewer/geometry.ts read-only).
- `src/squiggle/exports.ts`: `partsCSV(m)`, `brickLinkXML(m)` (all lots), `pickABrickFiles(m)` (exact LEGO
  template: header `elementId,quantity`, CRLF, no trailing newline, ≤ 400 lines/file, ≤ 999 per line — reuse or
  generalise src/export/order.ts), `shareImage(m, loaded) → Promise<Blob>` 1200×630 PNG (the model render on
  the left/centre, the original Squiggle thumbnail, "Chromie Squiggle #1234 in bricks", pieces · size, site
  name), `nameplateFiles(m)` (PNG plain + with cut marks), `makeKit(m, loaded, booklet) → ZIP` (PDF, parts
  CSV, BrickLink XML, Pick a Brick CSV(s), nameplate PNGs, share image, README.txt).
- `src/squiggle/video.ts`: `recordVideo(m, loaded, {format:'square'|'story', small?, onProgress})` with the
  Web Audio brick-click soundtrack (reuse src/export/sound.ts, generalise its types), ends on the finished
  model + nameplate close-up; ≈ 20–25 s. Frame: front view on the wall. MP4 when supported, else WebM.

## Page (index.html, src/main.ts, src/style.css)
- Header brand "Squiggle to Bricks". Hero: title, subtitle, "Squiggle #" field + Build button, examples:
  a few Squiggle numbers as chips (#1234, #7583 Perfect Spectrum, #3784 HyperRainbow Pipe, #102 Bold, #1000
  Slinky) — thumbnails loaded from Art Blocks at runtime, not hosted here. Small "or upload an image" link.
- Section ① "Your Squiggle": the original (with its Art Blocks features: Type, Spectrum, Segments…) next to
  the 3D brick model; format toggle Relief | Mosaic; for Relief the 3 display thumbnails (Frame, Floating,
  Backdrop, each with pieces and size cm) and Large | Small; for Mosaic 96×48 | 64×32. Key figures (pieces,
  size cm, weight, cost ≈), "More info" (every check in plain words, notes, origin of the data), video buttons
  (square, 9:16), Share on X, "Download nameplate (PNG)".
- Section ② "Instructions": the in-page reader (flip pages, thumbnails), Download PDF, Download full kit.
- Section ③ "Buy the bricks": visual shopping list with Squiggle / Display subtotal rows, Buy at LEGO (the
  3-step guide with the Pick a Brick screenshots, reuse public/help/*), Buy on BrickLink (copy XML + how to).
  Every lot of these models has a LEGO Element ID (verified), so the Punk "only parts LEGO sells" switch goes.
- FAQ adapted to Squiggles (Is this official? Can I really build it? What are the clear pieces? How do I hang
  the Frame? Where does the Squiggle come from — Art Blocks' public API, redrawn with its own script, nothing
  uploaded?). Meta/OG tags + public/og.png (1200×630, #1234 Frame) for the site.
- Mobile first: works at 375 px wide, no horizontal scroll, 16 px gutters; desktop two-column where it helps.
- Everything static, no tracking, no cookies.

## Quality bar
- `npx tsc --noEmit -p .` clean, `npx vitest run` green, `npx tsx scripts/verify-squiggle.ts` 0 failures on
  the 11 test Squiggles, `npm run build` OK.
- Full user flow proven with Playwright on desktop (1400×900) and mobile (390×844): type 1234 → original
  appears → Frame builds and animates → switch Floating/Backdrop/Mosaic/sizes → reader pages → every download
  (PDF, kit ZIP, CSV, XML, Pick a Brick CSV exact bytes, nameplate PNG, share image, video square & 9:16) →
  Before-you-order dialog → LEGO guide → BrickLink copy. Fallback paths via ?fail=. Upload path with an image.
- Generation (fetch excluded) under 15 s on a mid-range phone (CPU throttling 6×): whole flow to first model.
