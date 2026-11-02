# Zoom spike

Throwaway prototype: LikeC4 model → nested ELK layout in workers → PixiJS v8 renderer with continuous semantic zoom. Findings are in [../docs/research/2026-11-02-spike-findings.md](../docs/research/2026-11-02-spike-findings.md).

```bash
npm install
npm run dev        # extracts model/*/ to public/models/, serves http://localhost:5180
npm test           # unit tests for tree, aggregation, placement, camera, clipping
```

URL parameters: `?model=boutique|bigbank|synthetic`, `&n=10000` for the synthetic size, `&layout=packed|layered`.

Controls: scroll zooms at the cursor, drag pans, double-click flies into a card, `Esc` goes up a level, `0` fits all, `/` searches.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
```

`probe.mjs` drives Chrome (set `CHROME` to another binary), wheel-zooms from the overview into the deepest element, flies back out, pans the overview, and writes frame-time percentiles plus `window.__spike.gpu` so you can see which GPU rendered.

## Layout of the code

- `scripts/extract-likec4.mjs` — LikeC4 workspace → `{ elements, relations }` JSON.
- `src/model.ts` — hierarchy as flat arrays under a virtual root; relation roll-up.
- `src/layout.ts`, `layout.worker.ts`, `layoutPool.ts` — one ELK layout per container, batched per worker; cards scaled into their parent's content area.
- `src/camera.ts` — float64 camera, cursor-anchored eased zoom, inertia, fly-to about a fixed point.
- `src/render.ts` — per-frame traversal in screen space: culling, detail tiers, labels, edges, off-screen chips.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
