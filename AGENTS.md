# riggles-to-bricks

Turns any riggle into real LEGO brick build instructions, in the browser.
A fork of Squiggle to Bricks by John Karp (MIT), ported to riggles.

Vault note: `projects/riggles-to-bricks.md` in the orange-guinea-pig vault.
Read it first: it holds the decisions and why they are what they are.

## Non-negotiables

- **The site ships no API key and makes no network call while in use.** Hashes
  come from `src/data/riggles.json`, baked once by `npm run bake` (needs
  `RIGGLES_API_KEY`). The art engine is vendored. Keep it that way.
- **`src/riggle/engine.js` is the published riggles art engine, vendored.** Do
  not edit the body. The only local change is the export line at the end. To
  take a newer engine, copy `art/riggle-v4.js` from the riggles repo again and
  re-apply that one line.
- **MIT covers this repo's code only**, not the riggles artwork and not the
  engine. Do not relicense either by accident.
- Copy style: "onchain" one word. No em or en dashes. No emojis.

## Shape

- `src/riggle/` is the riggles side: the engine, the hash table, the loader,
  the curve adapter and the panels.
- `src/squiggle/` is the inherited builder: ribbon, displays, mosaic, booklet,
  exports. Still named for its origin.
- The two meet at `Curve` (`src/squiggle/curve.ts`). Everything downstream
  knows nothing about riggles.

## Before you change geometry

Run all three, not just the one you think is affected:

```bash
npm test                # 531
npm run check:colour    # colours against the real engine, offline
npm run sheet -- 2 13   # the art beside the bricks, as PNGs in out/sheet
```

Then sweep the collection. A sample of one size hid two real bugs: an odd
panel that built nothing, and a two stud ribbon that could not be supported.
Build every riggle in both mosaic sizes and a slice of them in all three
displays at both sizes, and check the rules pass and the body is still one
connected region.

Look at the render before handing anything over.
