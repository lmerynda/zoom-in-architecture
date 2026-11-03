# Zoom spike: findings

Date: 2026-11-02. Code: [`spike/`](../../spike). Follows [2026-11-02-landscape.md](2026-11-02-landscape.md), which proposed this spike.

## Verdict

**The browser + PixiJS path is good enough. No need for the Rust/WASM fallback.** Rendering has several times headroom at 10k elements. Layout and routing take 0.6 s at 10k once batched. Edges, the main readability risk in the first pass, now read cleanly: orthogonal routes through the gutters, plus focus highlighting. What remains is product polish, not engine risk.

## What was built

- **Data:** LikeC4 workspaces extracted via `LikeC4.fromWorkspace` → JSON:
  - `acme`, a realistic 96-element e-commerce landscape written for the spike;
  - the official boutique template;
  - Big Bank.

  There is also a deterministic synthetic generator (five levels) for scale tests.
- **Layout:** every container is laid out on its own by ELK `rectpacking` in web workers, aiming at the card's content aspect ratio. Children are same-size cards scaled into the parent's content area, so **positions never change while zooming**.
- **Edge routing:**
  - Sibling edges are routed orthogonally through the gutters by our own channel router (`src/route.ts`). It runs a cheapest-path search over gutter lines, with a bend penalty and a discount for reusing segments, so edges merge into shared trunks.
  - An edge between nested elements is composed (`src/edges.ts`): the route at their lowest common container, plus exit routes that climb out of each container in between through its gutters. **No edge ever crosses a card**, at any level.
- **Rendering:** a PixiJS v8 renderer rebuilt each frame in screen space from a float64 camera. Cards are nine-slice sprites with soft shadows. Labels are pooled bitmap text. A two-octave dot grid is anchored to the world, so you can always feel zoom and pan.
- **Semantic zoom:**
  - Children appear as faint previews from 1.5 px wide.
  - They gain labels as a child card grows from 70 to 120 px.
  - Leaves add the subtitle, then the description, then a dossier of relations.
- **Focus:**
  - Hover or click an element: relations leaving it turn amber, relations entering it cyan, and the cards at the other end glow in the same colours.
  - Clicking also fades everything unrelated and opens a details panel. The panel shows identity, path, description and rolled-up outgoing and incoming relations, each a jump.
  - Highlighting is decided per underlying relation, so a rolled-up edge lights up only when one of its own relations crosses the focus boundary.
- **Off-screen chips:** an edge whose far end is off screen ends in a chip at the screen border naming the largest off-screen ancestor ("Stripe ×2 →"), coloured by direction.
- **Game-style HUD:** breadcrumb, minimap with viewport crosshair, search-to-fly, double-click fly-in, `Esc` to clear the selection and then go up a level. Fly-to frames the target beside the details panel when it is open.

## Measurements

Headless Chrome 1440×900 at DPR 2, on an RTX 4070 (ANGLE D3D11). This is a fast discrete GPU. Integrated graphics are untested.

| Model | Elements / relations | Layout + routing | Zooming, CPU per frame p50 / p95 | Overview pan p95 | Frame interval |
|---|---|---|---|---|---|
| Acme (LikeC4) | 96 / 89 | 199 ms | 0.8 / 1.1 ms | 1.2 ms | 16.7 ms |
| Synthetic 1k | 1,063 / 1,239 | 309 ms | 1.0 / 1.8 ms | 2.0 ms | 16.7 ms, one 50 ms hitch |
| Synthetic 10k | 9,446 / 13,097 | 617 ms | 1.9 / 3.6 ms | 4.5 ms (1,496 cards drawn) | 16.7 ms, one 67 ms hitch |

The three questions the spike was for:

1. **Frame time at 1k and 10k.** Solved. Level of detail keeps the drawn set at about 1,500 cards at worst, however big the model is. There are rare single long frames (up to 67 ms) while frame CPU stays at or below 13.5 ms. They are outside our scene code, likely GPU texture uploads for new glyphs or garbage collection. Not investigated.
2. **Text crispness across a 1000× zoom.** Solved. Labels are sized in screen space (capped at 26 px), so they are never magnified past the font's 48 px raster. They are crisp at DPR 1 and 2. A unit test confirms the float64 camera stays exact at 10⁶×.
3. **ELK position stability.** Solved by construction for zooming: opening a container moves nothing. Stability across **model edits** (adding one service re-flows its container) is untested.

## Discoveries

- **elkjs has a fixed cost of about 30 ms per `layout()` call.** Sending all of a worker's containers as compound children of one dummy root is 18× faster.
- **`rectpacking` beats `layered` for this.** It fills 87% of each card against 54–79% for layered (`scripts/layout-bench.mjs`), it reads like a map, and it is three times faster. Layered's one advantage, routed edges, is now covered by our own router. The layered mode is gone.
- **Gutter routing solves most of the edge problem.** Because cards sit on a near-grid with fixed gutters, a tiny routing grid (gutter lines plus card centre lines) is enough: a few dozen nodes per container. Composing routes up the hierarchy keeps lines out of cards at every zoom level. Shared trunks bundle edges naturally. The cost of a trunk is ambiguity about which pair it joins, and hover or selection resolves that.
- **Highlight per relation, not per rolled-up endpoint.** The first version lit any edge touching a container that held the focus, so selecting Checkout also lit "Support → Order Service". Tracking crossings per folded relation fixed it (with a unit test).
- **Off-screen chips are the most game-like win.** A nameable direction ("this talks to Stripe, that way") beats lines vanishing at the edge.
- **Previews from 1.5 px stop popping.** The design choice that matters most is to open on legibility (child card width), not at fixed zoom levels.
- **LikeC4 works as a data layer.** Extraction takes about 200 ms per workspace. `fromWorkspace` keeps the process alive (a watcher), so the CLI must dispose and exit.

## A real codebase: Galaxy Wars

`scripts/scan-galaxy-wars.mjs` generates a LikeC4 model of the Galaxy Wars repository straight from its code:
- **Size:** 717 elements (621 files, 30 folders, 42 name clusters) and 3,261 relations.
- **Levels:** system → area → project → folder → cluster → file.
- **Descriptions:** each file's `/// <summary>`.
- **Relations:** type references between files, limited to the projects each project references. The WebSocket, TCP and database seams are declared by hand.

Layout takes 325 ms, and frames take 1.6 ms p50 / 4.6 ms p95 with the busiest class selected (`SectorRuntime`, 136 outgoing relations).

What it taught:
- **Clustering by name prefix makes big flat folders readable.** The server's Simulation folder (79 files) becomes Experiences, Sector, Mining, Snapshot and Pilot. The Unity client (135 scripts) becomes Flight, Mission, Sector, Hangar and so on. Folders whose names share no prefixes stay flat rather than collapse into one "Other".
- **File-level type references give useful relations without any annotation.** Selecting the Browser Bridge shows exactly the WebSocket inbound from the browser client and its use of Client Transport and the shared contracts.
- **Real names exposed a bug the sample models hid.** Labels were fitted against their already-scaled width, so long class names overflowed. Labels are now fitted by natural width, and edge labels are capped to fit the gaps between cards.

## Game-style controls

The goal is the control vocabulary of games, not their graphics. Each borrowed pattern answers a real navigation question in an architecture map:

| Question | Game pattern | Control |
|---|---|---|
| "Take me to X" | Fast travel / console | `Ctrl+K` palette: fuzzy search plus commands |
| "I was just somewhere useful" | Return to last location | `Backspace`, `Alt+←/→`; every jump is recorded with its selection |
| "What does this talk to?" | Tab-targeting, target of target | `]` / `[` cycle callees / callers with both framed; `Enter` walks |
| "What can I do with this?" | Command wheel | Right-click: six actions, flick-to-select |
| "How does A reach B?" | GPS route with waypoints | Wheel "Route here" from the selection; cheapest path that prefers following the arrows; click a stop to go there |
| "Remember this, and where is it?" | Quest markers | Wheel "Pin"; off-screen pins point the way from the screen edge; pins are in the palette |
| "What is this, and what is that thing it mentions?" | Nested tooltips (Crusader Kings) | Hover and hold: lock, then hover names inside |
| "Let me just move around" | RTS minimap | Minimap click and drag; arrow keys |
| "Get me out of this" | Layered Esc | Closes the innermost layer first |

All of these were driven with real mouse and keyboard input by `scripts/ux-tour.mjs`, and recorded by `scripts/record.mjs gw-controls`. Driving them found three real bugs:
- The closed palette kept keyboard focus and swallowed every later key.
- Moving onto a tooltip counted as leaving the map and closed it.
- Back restored the place but not the selection, because the jump was recorded after the selection changed.

Pure logic has unit tests: route search, history and fuzzy matching.

### Trimmed to six keys

The first pass bound a key to nearly every pattern: about 25 bindings across four columns of a help screen, which felt like too much to learn. The trim keeps only what answers a question you ask constantly, and moves the rest where it can be found rather than memorised:
- **Kept on keys:** `Ctrl+K`, `Backspace`, `]` / `[` with `Enter`, `Esc`, `?`, plus the arrows.
- **Moved to the wheel:** route here and pin. The route picking mode (`R`, then click) went: the wheel's "Route here" does the same from where the pointer already is. Waypoints step by clicking the route panel, not `N` / `P`.
- **Moved to the palette and top bar:** lenses (`L`), sound (`M`), whole map (`0`).
- **Removed:**
  - control groups (`Ctrl+1–9`) and their slot bar: pins plus the palette cover "remember this place";
  - pin notes;
  - `Tab` sibling cycling;
  - `F`, which duplicated double-click and `Enter`;
  - `WASD` / `QE` / `Shift` boost.

The help screen is now two short columns, mouse and keys.

The motion work from the same pass stays, but secondary:
- van Wijk–Nuij flights;
- flow particles;
- the starfield;
- reveal ripple and pulses;
- lock-on reticles;
- the altimeter and region banner;
- lenses.

## Live mode, and layout stability across edits

The spike's open question was whether positions survive model edits, not just zooming. With live mode they mostly do:

- **Layouts are reused.** The viewer diffs model versions by element id. A container whose children and sibling edges did not change keeps its previous layout exactly; only changed containers run ELK again.
  - Adding one service to Acme redid 2 of 28 layouts, and 0 of 80 elements outside the edited domain moved.
  - Re-scanning Galaxy Wars with no code change redid 0 of 94, and the swap took 25 ms.
- **Child order is stable.** Rectpacking places children in input order, so the first version inserted the new service first and reflowed every sibling; the selected card jumped 300 px. Laying out children in their previous order, with new ones appended, keeps siblings in place as far as the packing allows.
- **The camera holds still.** It is anchored on the selection, or on what is under the screen centre, and moves with it during the morph. In the test the selected card stayed exactly in place (0 px).
- **The update is fast.** It lands 0.7–0.9 s after saving a .c4 file: extraction is about 0.4 s, the swap about 0.2 s.
- **State carries over.** Selection, target, route, pins, bookmarks and history all follow the new version. They are keyed by element id, not index; history and bookmarks used to store indices, which would have broken across versions (and across page reloads after an edit).

Two environment lessons:
- Vite's watcher does not report files outside its module graph, such as the .c4 sources. The plugin uses Node's recursive `fs.watch` instead.
- The plugin must not start under Vitest, or the test run cannot exit.

## Known rough edges

- **Exits through the header:** routes that leave a container through its top port cross the header band, so a line passes under the title area.
- **Trunk arrowheads:** lines entering children along a shared trunk can look like edges between siblings.
- **Equal-size cards at the top level:** the landscape's most important element (the enterprise) is the same size as an actor card.
- **Empty full-screen leaves:** a leaf zoomed to fill the screen is mostly empty below its dossier.

## Not verified

- Integrated or low-end GPUs, Safari and Firefox, touch and pinch.
- Interaction feel: judged from frame intervals and screenshots, not by a person scrolling.
- Large real models: 10k is synthetic, with random, dense relations.

## Recommended next steps

1. Get a person to drive it with real models and note where it confuses. The design now needs human feedback more than more code.
2. Visual identity pass: kind icons and shapes (person, database, queue), and a weighted top level.
3. Zoom past leaves into code (blockviz-style levels).

Screenshots: `node scripts/tour.mjs` writes the walkthrough into `spike/shots/tour/` (not committed).
