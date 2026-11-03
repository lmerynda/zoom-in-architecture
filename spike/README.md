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

## Live mode

With `npm run dev` running, saving any `model/<name>/*.c4` file re-extracts that workspace and the open map updates in place: unchanged containers keep their exact layout, survivors glide to their new places, new cards grow out of their parent, changed cards glow (green added, amber changed), and a toast lists what was removed. The camera stays on the selection, or on what is under the screen centre. If `model/galaxy-wars` exists and the Galaxy Wars checkout is at `GALAXY_WARS_REPO` (default `F:/projects/galaxy-wars`), saving a `.cs` or `.rs` file there re-runs the scanner too.

`node scripts/live-test.mjs` edits `model/acme/model.c4` while the map is open, checks the update, then restores the file.

## Controls

Controls borrow from games. Press `?` in the app for the full sheet.

Six keys plus the mouse; everything else is in the command wheel or the palette.

| Control | Does |
|---|---|
| Wheel, drag, click, double-click | Zoom at the cursor, pan, select (out in amber, in in cyan), fly in |
| Right-click a card | Command wheel: fly in, select, calls, called by, route here (from the selection), pin; or hold right, flick, release |
| `Ctrl+K` or `/` | Travel to any element, pin or command (lenses, sound, clear route); `Shift+Enter` routes there from the selection |
| `Backspace` | Back to the last place; `Alt+→` and the mouse buttons go back and forward |
| `]` / `[` | Look at what the selection calls / what calls it, with both framed; `Enter` goes there |
| `Esc` | Closes the innermost thing first: wheel, help, target, route, selection, then goes up a level |
| `?` | The controls screen |

Also: hovering and holding still locks a tooltip whose names open their own tooltips; a route's stops are clickable in its panel; pinned cards point the way from the screen edge; the minimap clicks and drags; arrow keys and `+` / `-` move the camera; the lens bar and sound button are in the top bar.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
DPR=2 node scripts/tour.mjs                                # screenshot walkthrough into shots/tour/
node scripts/ux-tour.mjs                                   # drives every control with real input into shots/ux/
node scripts/live-test.mjs                                 # edits a model while the map is open, checks the live update
node scripts/record.mjs gw-controls gw-dive                # frame-exact MP4s into shots/video/
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
- `src/live.ts`, `vite.config.ts` — live mode: model diff, layout reuse and stable child order; the dev-server watcher.
- `src/controls/` — game-style controls: palette, history, target cycling, wheel, routes, pins, tooltips.
- `model/acme/` — the realistic sample model.
- `scripts/scan-galaxy-wars.mjs` — code scanner that generates the Galaxy Wars model.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
