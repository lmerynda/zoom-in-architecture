# Zoom spike

Throwaway prototype: LikeC4 model → nested ELK layout in workers → PixiJS v8 renderer with continuous semantic zoom. Findings are in [../docs/research/2026-11-02-spike-findings.md](../docs/research/2026-11-02-spike-findings.md).

```bash
npm install
npm run dev        # extracts the models to public/models/, serves http://localhost:5180
npm test           # unit tests: tree, aggregation, placement, camera, clipping, live diff, graph, map
```

URL parameters: `?model=<name>` (default `acme`), and `?model=synthetic&n=10000` for a generated landscape of that size. The tabs list every model there is.

## Map your own codebase

A map shows a codebase's architecture: the processes that run, the components inside them, and the files inside those. Making one takes two steps.
- **The file graph, from code:** `npm run zoom -- graph <repo>`. For a large repo, `--folders` gives an overview by folder and `--under <folder>` lists one part.
  - It keeps only application files: JS/TS that an entry point reaches through imports, what non-test C#, Rust, Java and Go projects compile, and Python packages plus the scripts and app modules that start them.
  - Entry points are pages' scripts (inline module scripts included), package.json entries, `node <file>` npm scripts and `main` methods. Imports of wasm-pack output lead back to the Rust crate, Unity sees only the projects its `Packages/manifest.json` names, Go `//go:embed` files and build-tag variants count, and Python imports resolve through `__init__.py` re-exports (`TYPE_CHECKING` imports are type-only).
  - Tests, `eslint.config`, `vite.config`, `playwright.config` and dead code drop out.
  - It resolves every reference between the files it keeps: relative imports, tsconfig paths, workspace packages, C# types through ProjectReferences, Java packages and imports, and Rust modules and crates.
  - Named imports through a barrel (an `index.ts` that re-exports) point at the file that defines the name. Type-only imports are listed but not drawn, since they are compile-time coupling, not runtime use.
  - It marks each file's routes, outbound calls, stores, schedules, sockets, messages (`postMessage`), process launches and file handoffs, with line numbers, and lists the config and deploy files. Manifests with no application code (a docs site, a monorepo root) are listed with the reason.
- **The map, from an agent:** `/map-repo <repo>` in Claude Code runs the [map-repo skill](../.claude/skills/map-repo/SKILL.md).
  - The agent first works out what the product is for and lists its headline features, in the product's own words, from its README, docs, screens and routes.
  - It puts the product's apps on top and its development tooling in a group of its own, gives each feature a node named for it, and groups the remaining files by responsibility.
  - Each feature in the map names the nodes that carry it. The viewer finds those nodes when you type a feature's name into Ctrl K, and shows the features as chips in the details panel. Only cards that carry a feature are drawn at double size, so a large pile of tooling or plumbing never outweighs the product.
  - It adds links the graph cannot see, such as HTTP calls between the client and the server or the database, each with `file:line` evidence. Publishing copies the cited lines into the model, and the details panel shows them under the link.
  - It checks the map with `npm run zoom -- check <repo> <map.json>` and publishes it with `npm run zoom -- publish <repo> <map.json>`.

`check` refuses:
- a map that leaves an application file out, or lists a file that isn't one;
- a link without evidence, or with evidence that isn't in the repo;
- bad node ids and kinds;
- a feature that names a node the map does not declare.

It warns when:
- evidence doesn't land on a line the graph marked (it quotes that line), or sits in a file at neither end of the link;
- the map lists no features;
- a feature sits more than three levels down;
- a top-level app carries no feature, which usually means it is tooling;
- a top-level library is used by fewer than two product parts (dev tools don't count, and a published package is exempt);
- the top level holds more than three libraries.

`npm run zoom -- why <repo> <map.json> <file>…` shows which node holds each file, and its users and uses grouped by node. `npm run zoom -- audit <repo> <map.json>` lists files used mostly from a sibling node that use nothing in their own: placement to review. For a re-map, `check … --uncited` lists marked lines no link cites.

`npm run zoom -- compare <repo> <a.json> <b.json>` measures how alike two maps of one repo are, for example two agent runs. It reports grouping agreement at the process and leaf levels as an adjusted Rand index, pairs each group with its closest match by file overlap, and lists the links only one map has. Relations between files always come from the graph, so a map cannot invent a dependency.

The map format is in the skill. [maps/zoom-in-architecture.json](maps/zoom-in-architecture.json) is this repository's map, and the tours and recordings use it.

Nothing is written into the mapped repository. Published maps live in `imports/<name>/` (`map.json` and `source.json`), which is not committed, and open at `?model=<name>`.

## Live mode

With `npm run dev` running, any model rewritten under `public/models/` updates the open map in place, and a newly published map gets its tab:
- unchanged containers keep their exact layout;
- survivors glide to their new places, and new cards grow out of their parent;
- changed cards glow (green added, amber changed), and a toast lists what was removed;
- the camera stays on the selection, or on what is under the screen centre.

Models are rewritten when:
- a `.c4` sample under `model/` is saved;
- an agent publishes a map;
- a mapped repository's source changes. The dev server then re-publishes it from its stored map. New files go beside the files they reference, and a link whose evidence moved stays drawn, with a warning.

Two scripts check this end to end:
- `node scripts/live-test.mjs` edits `model/acme/model.c4` while the map is open, checks the update, then restores the file.
- `node scripts/publish-test.mjs` publishes a map of a copy of `test/fixtures/polyglot` the way an agent does. It checks that the open viewer gets the tab without reloading, then edits the source and checks that the map follows. Afterwards it removes the copy.

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

Also: hovering and holding still locks a tooltip whose names open their own tooltips; a route's stops are clickable in its panel; zooming past a file card shows its source (the wheel stops once it reads comfortably), coloured, with cited lines in amber and the graph's marked lines tagged with their kind; a relation that a map link backs lists its cited code lines (two, then "+N more"), and clicking one opens its file at that line, and one whose line no longer resolves says so; pinned cards point the way from the screen edge; the minimap clicks and drags; arrow keys and `+` / `-` move the camera; the lens bar and sound button are in the top bar.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
DPR=2 node scripts/tour.mjs                                # screenshot walkthrough into shots/tour/
node scripts/ux-tour.mjs                                   # drives every control with real input into shots/ux/
node scripts/live-test.mjs                                 # edits a model while the map is open, checks the live update
node scripts/publish-test.mjs                              # publishes a map like an agent, edits the repo, checks the map follows
node scripts/record.mjs acme-controls code-dive            # frame-exact MP4s into shots/video/ (code-* scenes use this repo's map)
```

`probe.mjs` drives Chrome (set `CHROME` to another binary), wheel-zooms from the overview into the deepest element, flies back out, pans the overview, and writes frame-time percentiles plus `window.__spike.gpu` so you can see which GPU rendered.

## Layout of the code

- `scripts/extract-likec4.mjs` — the LikeC4 samples under `model/` → `{ elements, relations }` JSON.
- `src/model.ts` — hierarchy as flat arrays under a virtual root; relation roll-up.
- `src/layout.ts`, `layout.worker.ts`, `layoutPool.ts` — one ELK rectpacking layout per container, batched per worker, sibling edges routed there; cards scaled into their parent's content area. A child that holds far more files than its siblings spans 2 × 2 cells.
- `src/route.ts` — orthogonal channel router through the gutters, with trunk sharing.
- `src/edges.ts` — composes routes across nesting levels so no edge crosses a card.
- `src/camera.ts` — float64 camera, cursor-anchored eased zoom, inertia, fly-to about a fixed point.
- `src/render.ts` — per-frame traversal in screen space: culling, detail tiers, labels, edges, focus highlighting, off-screen chips.
- `src/details.ts` — the selection panel.
- `src/icons.ts` — which icon each element gets, and the icons themselves.
- `src/code.ts` — the code view: a file card's source, flowed into columns and scaled with the card, served by the dev server's `/source` endpoint.
- `src/live.ts`, `vite.config.ts` — live mode: model diff, layout reuse and stable child order; the dev-server watcher.
- `src/controls/` — game-style controls: palette, history, target cycling, wheel, routes, pins, tooltips.
- `model/acme/` — the realistic sample model.
- `scripts/graph.mjs` — the application file graph; `scripts/map.mjs` — map checks, the viewer model, publishing and `index.json`; `scripts/zoom.mjs` — the agent's commands; `scripts/self-import.mjs` — this repo from its map, for tours.
- `src/models.ts` — the model tabs.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
