# Zoom spike: findings

Date: 2026-11-02. Code: [`spike/`](../../spike). Follows [2026-11-02-landscape.md](2026-11-02-landscape.md), which proposed this spike.

## Verdict

**The browser + PixiJS path is good enough. No need for the Rust/WASM fallback.** Rendering has roughly 5× headroom at 10k elements. Layout is fast once batched. The hard problems left are design problems (edges, layout aesthetics), not engine problems.

## What was built

- LikeC4 workspaces (the official boutique template and Big Bank) extracted via `LikeC4.fromWorkspace` → JSON, plus a deterministic synthetic generator (five levels: domain → system → container → component → module).
- Every container laid out on its own by ELK in web workers. Children are same-size cards, scaled into the parent's content area. That gives one world with **positions that never change while zooming**.
- PixiJS v8 renderer rebuilt each frame in screen space from a float64 camera. Cards are nine-slice sprites, labels are pooled bitmap text.
- Semantic zoom:
  - Children appear as faint previews from 1.5 px wide.
  - They gain labels and brighten as a child card grows from 70 to 120 px.
  - Leaves add the subtitle, then the description, then a dossier of incoming and outgoing relations.
- Edges rolled up to whatever is currently shown, with counts, merged in both directions, and highlighted on hover.
- An edge whose far end is off screen ends in a chip at the screen border naming the largest off-screen ancestor ("Accounts Store ×12 →").
- Game-style HUD: breadcrumb, minimap with viewport crosshair, search-to-fly, double-click fly-in, `Esc` up a level.

## Measurements

Headless Chrome 1440×900 on an RTX 4070 (ANGLE D3D11). This is a fast discrete GPU. Integrated graphics are untested.

| Model | Elements / relations | Layout | Zooming, CPU per frame p50 / p95 | Overview pan p95 | Frame interval |
|---|---|---|---|---|---|
| Boutique (LikeC4) | 23 / 26 | 195 ms | 0.7 / 1.8 ms | — | 16.7 ms |
| Big Bank (LikeC4) | 19 / 26 | 174 ms | 0.7 / 1.2 ms | — | 16.7 ms |
| Synthetic 1k | 1,063 / 1,239 | 261 ms | 0.9 / 1.8 ms | — | 16.7 ms |
| Synthetic 10k | 9,446 / 13,097 | 521 ms | 1.9 / 3.3 ms | 3.1 ms (1,496 cards drawn) | 16.7 ms |
| Synthetic 10k, DPR 2 | same | 566 ms | 1.6 / 2.6 ms | 3.0 ms | 16.7 ms, one 50 ms hitch |

The three questions the spike was for:

1. **Frame time at 1k and 10k.** Solved. Level of detail keeps the drawn set at about 1,500 cards at worst, however big the model is. Isolated 10–20 ms frames happen the first time many labels appear (bitmap text creation). Fix that by pre-warming or creating labels across frames.
2. **Text crispness across a 1000× zoom.** Solved. Labels are sized in screen space (capped at 26 px), so they are never magnified past the font's 48 px raster. They are crisp at DPR 1 and DPR 2. The 10k zoom path spans 1,250×. A unit test confirms the float64 camera stays exact at 10⁶×.
3. **ELK position stability.** Solved by construction for zooming: each container's layout is local and scaled into a fixed-size card, so opening a container moves nothing. Stability across **model edits** (adding one service re-flows its container) is untested and is the real remaining question.

## Discoveries

- **elkjs has a fixed cost of about 30 ms per `layout()` call.** Sending all of a worker's containers as compound children of one dummy root is 18× faster (1.8 ms per container). This took 10k layout from 5.2 s to 0.5 s.
- **ELK `layered` wastes much of each card.** On the synthetic model, top-down layered layouts fill 54% of the card on average, wrapped left-to-right layered 79%, and `rectpacking` 87%, with a worst case of 73% against 30% for wrapped layered (`scripts/layout-bench.mjs`). Packed reads like a map: the Atlas-style even grid, with the next level visible as a preview inside every card. Layered keeps edge-aware ordering and routed edges, but it produces tall columns and spaghetti. **Packed is the default.**
- **Edges are the main open problem.** Roll-up, counts, quieter cross-level lines and hover highlighting help. At mid zoom on a densely connected model it is still noisy, and packed layout routes nothing, so lines run straight across cards. This needs real design work: orthogonal or "metro" routing between grid cells, bundling by container pair, and showing all edges only for the hovered or selected element when density is high.
- **Off-screen chips are the most game-like win.** Collapsing an off-screen end to its largest off-screen ancestor gives a nameable direction ("this talks to Ledger Division, that way") instead of lines vanishing at the edge.
- **Previews from 1.5 px stop popping.** The structure two levels down is always faintly visible, and detail grows in place. The design choice that matters most is to open on legibility (child card width), not at fixed zoom levels.
- **Labels still collide** with card titles and with each other. They need collision against cards, not just against other labels.
- **LikeC4 works as a data layer.** Extraction takes about 200 ms per workspace. `fromWorkspace` keeps the process alive (a watcher), so the CLI must dispose and exit. For a live mode, its `onModelUpdate` is the hook.

## Not verified

- Integrated or low-end GPUs, Safari and Firefox, touch and pinch.
- Interaction feel: smoothness was judged from frame intervals and screenshots, not by a person scrolling.
- Real large models: 10k is synthetic, with random, dense relations. That is probably the worst case for edges.

## Recommended next steps

1. Edge design on the packed grid: routing, bundling, focus-dependent density. This decides whether the tool reads well.
2. Visual design pass on the card, header and HUD language, aiming for the polish of a strategy-game map.
3. Live mode: watch the LikeC4 workspace and re-lay out only the containers that changed.
4. Zoom past leaves into code (blockviz-style levels), once the architecture levels feel right.
