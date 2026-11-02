# Zoom spike

Throwaway prototype: LikeC4 model → nested ELK layout in workers → PixiJS v8 renderer with continuous semantic zoom. Findings are in [../docs/research/2026-11-02-spike-findings.md](../docs/research/2026-11-02-spike-findings.md).

```bash
npm install
npm run dev        # extracts model/*/ to public/models/, serves http://localhost:5180
npm test           # unit tests for tree, aggregation, placement, camera, clipping
```

URL parameters: `?model=acme|boutique|bigbank|synthetic|galaxy-wars` (default `acme`) and `&n=10000` for the synthetic size.

`galaxy-wars` is generated from a local checkout of that repository and is not committed:

```bash
node scripts/scan-galaxy-wars.mjs F:/projects/galaxy-wars   # writes model/galaxy-wars/*.c4
npm run extract                                            # or restart npm run dev
```

The scanner builds system → area → project → folder → name cluster → file from the code, takes each file's `/// <summary>` as its description, derives relations from type references between files (limited to referenced projects), and adds the WebSocket, TCP and database seams by hand.

Controls: scroll zooms at the cursor, drag pans, click selects (relations out in amber, in in cyan, details panel on the right), double-click flies into a card, `Esc` clears the selection and then goes up a level, `0` fits all, `/` searches.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
DPR=2 node scripts/tour.mjs                                # screenshot walkthrough into shots/tour/
```

`probe.mjs` drives Chrome (set `CHROME` to another binary), wheel-zooms from the overview into the deepest element, flies back out, pans the overview, and writes frame-time percentiles plus `window.__spike.gpu` so you can see which GPU rendered.

## Layout of the code

- `scripts/extract-likec4.mjs` — LikeC4 workspace → `{ elements, relations }` JSON.
- `src/model.ts` — hierarchy as flat arrays under a virtual root; relation roll-up.
- `src/layout.ts`, `layout.worker.ts`, `layoutPool.ts` — one ELK rectpacking layout per container, batched per worker, sibling edges routed there; cards scaled into their parent's content area.
- `src/route.ts` — orthogonal channel router through the gutters, with trunk sharing.
- `src/edges.ts` — composes routes across nesting levels so no edge crosses a card.
- `src/camera.ts` — float64 camera, cursor-anchored eased zoom, inertia, fly-to about a fixed point.
- `src/render.ts` — per-frame traversal in screen space: culling, detail tiers, labels, edges, focus highlighting, off-screen chips.
- `src/details.ts` — the selection panel.
- `model/acme/` — the realistic sample model.
- `scripts/scan-galaxy-wars.mjs` — code scanner that generates the Galaxy Wars model.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
