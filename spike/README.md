# Zoom spike

Throwaway prototype: LikeC4 model → nested ELK layout in workers → PixiJS v8 renderer with continuous semantic zoom. Findings are in [../docs/research/2026-11-02-spike-findings.md](../docs/research/2026-11-02-spike-findings.md).

```bash
npm install
npm run dev        # extracts the models to public/models/, serves http://localhost:5180
npm test           # unit tests: tree, aggregation, placement, camera, clipping, live diff, graph, map
```

URL parameters: `?model=<name>` (without it, the most recently uploaded map; `acme` when there are only samples), and `?model=synthetic&n=10000` for a generated landscape of that size. The tabs list every model there is. A first visit shows one line beside the breadcrumb on what the cards and arrows are; the first scroll, click or key puts it away for good.

## Map your own codebase

A map shows a codebase's architecture: the processes that run, the components inside them, and the files inside those. Making one takes two steps.
- **The file graph, from code:** `npm run zoom -- graph <repo>`. For a large repo, `--folders` gives an overview by folder and `--under <folder>` lists one part.
  - It keeps only application files: JS/TS that an entry point reaches through imports, what non-test C#, Rust, Java and Go projects compile, and Python packages plus the scripts and app modules that start them. Server-side views (templates in a `templates/` or `views/` folder of a project with application code) count too: a controller that names a view (`return "owners/ownerDetails"`) points at it, and a template points at the layouts and fragments it uses.
  - Entry points are pages' scripts (inline module scripts included), package.json entries, `node <file>` npm scripts and `main` methods. Imports of wasm-pack output lead back to the Rust crate, Unity sees only the projects its `Packages/manifest.json` names, Go `//go:embed` files and build-tag variants count, and Python imports resolve through `__init__.py` re-exports (`TYPE_CHECKING` imports are type-only).
  - Tests, `eslint.config`, `vite.config`, `playwright.config` and dead code drop out.
  - It resolves the references between the files it keeps by pattern, not by compiling: relative imports, tsconfig paths, workspace packages, C# types through ProjectReferences, Java packages and imports, and Rust modules and crates. A reference made by reflection, string-named injection or generated code can be missed silently. A relative import that resolves to no file is a certain miss: `check` lists it, and the viewer marks its line "missed" and names it in the file's details panel.
  - Named imports through a barrel (an `index.ts` that re-exports) point at the file that defines the name. Type-only imports are listed but not drawn, since they are compile-time coupling, not runtime use.
  - It marks each file's routes, outbound calls, stores, schedules, sockets, messages (`postMessage`), process launches and file handoffs, with line numbers, and lists the config and deploy files. Manifests with no application code (a docs site, a monorepo root) are listed with the reason.
- **The map, from an agent:** `/map-repo .` in a session in the project runs the [map-repo skill](../skills/map-repo/SKILL.md). `node scripts/zoom.mjs install-skill` installs it for Claude Code and Codex, with this checkout's path in its commands; run it again after editing the skill.
  - The agent first works out what the product is for and lists its headline features, in the product's own words, from its README, docs, screens and routes.
  - The skill describes what the viewer can show, and the agent chooses the levels that suit the repo. There is no fixed depth. The defaults: the product's apps on top and development tooling in a group of its own; inside an app, the repo's own split, by feature or by layer (controllers, models, views); the individual files at the bottom, with the graph's arrows between them.
  - Each feature in the map names the nodes that carry it, or the files, when a layered app spreads a feature across layers. The viewer finds those nodes when you type a feature's name into Ctrl K, and shows the features as chips in the details panel. Only cards that carry a feature are drawn at double size, so a large pile of tooling or plumbing never outweighs the product.
  - It adds links the graph cannot see, such as HTTP calls between the client and the server or the database, each with `file:line` evidence. Publishing copies the cited lines into the model, and the details panel shows them under the link.
  - It checks the map with `npm run zoom -- check <repo> <map.json>` and publishes it with `npm run zoom -- publish <repo> <map.json>`, which uploads it to the running viewer (below).
- **The Connections view, for every model:** the same map, the same zoom into cards and code, but each level laid out by connection instead of map order. Cards rank by breadth, then volume: the share of their siblings they reach, plus half their relations on a log scale against the busiest sibling. A shared-types library imported hundreds of times by a few parts does not outrank the part that talks to all of its peers, and a heavy part missing one sibling is not ranked below a light one that touches them all. The most connected child sits in the middle (on a 2 × 2 card when the level has four or more; half a cell off the exact middle when the ring around it would otherwise leave a side empty); the rest fill rings outward in rank order, each taking the cell of its ring nearest the siblings it is coupled with, so distance from the centre follows rank and a level reads from its centre of gravity out to what barely depends on anything. Cards stay on the grid, so edges keep their gutters. Each card wears its rank as a badge in its corner ("#1"; an open card puts it in its header) and shows the relations crossing it and how many of its siblings it reaches ("187 relations · 9 of 9 siblings"): a hub that many use and a part that talks to everything both rank high, and the last number tells them apart, and `.` / `,` select the next or previous card of the level by importance, starting at #1. It came from a force-directed experiment ([docs/research/2026-11-10-force-layout-experiment.md](../docs/research/2026-11-10-force-layout-experiment.md)): free placement showed coupling well at component level but turned files into a hairball and dropped the zoom.
- **The Requests view, from code:** publishing also writes `<name>.requests.json` for any app with endpoints, and an Architecture / Requests switch appears beside the lenses: like a lens, it is a way of looking at the open model.
  - The landscape is the edge: the callers, the backend, and the stores and services its requests reach.
  - Inside the backend sit its route groups, by path. A group past 9 endpoints splits by the next path segment, and what is still crowded groups by the things its routes act on: `send-attack` and `withdraw-attack` go under "attack", while the actions (`send`, `withdraw`) never group. Inside a group sit its endpoints, each titled with its method and full path however long (also in `metadata.method` and `metadata.route`; the viewer fits it to the card), read from:
    - Spring: a class-level `@RequestMapping`;
    - ASP.NET: `[Route]` on the controller;
    - FastAPI and Flask: routers or blueprints mounted with a prefix, even one held in a constant;
    - Express: routers mounted with `.use('/api', router)`, down a chain;
    - Gin: groups held in variables (`v1 := r.Group("/api")`) and passed to the functions that register routes on them.

    A prefix added by a custom framework convention, such as an ASP.NET `IControllerModelConvention`, is not read.
  - A route that names its handler (`router.POST("/login", UsersLogin)`) starts its path at that function, in the same file, its Go package, or the JS module it was imported from.
  - Inside an endpoint is the request's path as numbered steps, in call order: each file is followed at once by what it calls, in the order its body first uses them (a field of a type counts as using that type):
    - the handler method;
    - the files its body calls that lead to a store or another service (fields lead to their types, helper methods in the same file count; a word inside a string or a comment is not a use, so the view name `"owners/findOwners"` does not call an `owners` field);
    - below those, what the called methods use, method by method: a service's other methods, and the stores only they reach, are not on this path. A file that declares no code of its own (a generated or inherited API, such as a Spring Data repository interface) is followed whole; one that does, but not the method called (an inherited method), is where the path stops, since none of its own code runs. The path also stops at the first file that reaches a store or service;
    - beside the numbered path, as unnumbered cards hanging off the handler, the types it only names (request and response objects, an object whose accessors it reads): they do not run in sequence. A file whose called methods do work (more than an accessor, a lazy getter or a `new` factory) is a numbered step even when it reaches no store;
    - what comes back: a view it renders (constants lead to the view names they hold), a redirect (`"redirect:/owners/" + owner.getId()` reads `/owners/{id}`), or the body it returns. A handler with one answer ends its numbered path there: the view as the last step, then a Response card. A handler with several branches where its source branches: each view it may render is an unnumbered card off the handler, and each answer is a Response card of its own (`Response · redirect /owners/{id}`, `Response · renders owners/ownersList`), off the step that gives it.
  - Each card names the lines it is about (`metadata.span`, "166-177"), so its code opens exactly there: the handler's method from its signature to its closing brace (the route line above it stays a `route` mark), the first method its caller calls in a later step, a type's declaration, a view whole. A file whose called method it does not declare opens at its first declaration.
  - The numbered steps are one lane: exactly one arrow from each step to the next, titled with what the first imports of the second (`then` when it imports nothing of it: the request just runs it next), so a layered layout draws them left to right. Types hang off the handler that names them, a branch's views and answers off the step that gives them. Arrows out to stores carry the map's own evidence.
  - A caller the map links to the app as a whole reaches the app once; one linked to a file or a component reaches the endpoints in it.

`check` refuses:
- a map that leaves an application file out, or lists a file that isn't one;
- a link without evidence, or with evidence that isn't in the repo;
- bad node ids and kinds;
- a feature that names neither a node the map declares nor an application file.

It warns when:
- evidence doesn't land on a line the graph marked (it quotes that line), or sits in a file at neither end of the link;
- the map lists no features;
- a feature sits more than three levels down;
- a top-level app carries no feature, which usually means it is tooling;
- a top-level library only one app uses (fold it in), or only one product app and dev tools use (make it a component of the shared-library node); a published package is exempt;
- the top level holds more than three libraries.

`npm run zoom -- why <repo> <map.json> <file>…` shows which node holds each file, and its users and uses grouped by node. `npm run zoom -- audit <repo> <map.json>` lists files used mostly from a sibling node that use nothing in their own: placement to review. For a re-map, `check … --uncited` lists marked lines no link cites, with the routes no link reaches (pages people open, or an API outside callers use) listed apart.

`npm run zoom -- compare <repo> <a.json> <b.json>` measures how alike two maps of one repo are, for example two agent runs. It reports grouping agreement at the process and leaf levels as an adjusted Rand index, pairs each group with its closest match by file overlap, and lists the links only one map has. Relations between files always come from the graph, so a map cannot invent a dependency.

The map format is in the skill. [maps/zoom-in-architecture.json](maps/zoom-in-architecture.json) is this repository's map, and the tours and recordings use it.

## Projects upload; the viewer never reads them

The viewer (`npm run dev`) is a service that mapped projects upload to. It never reads, watches or depends on a project's folder.
- **Upload:** `publish` checks the map, then sends one bundle to `POST /upload`: the map, the model, the Requests view and the source of every file the model shows. It goes to http://localhost:5180 unless `--to <url>` or `ZOOM_URL` names another viewer. The commands run from anywhere, usually from the project itself: `node <this checkout>/spike/scripts/zoom.mjs publish . map.json`.
- **Storage:** the viewer keeps each bundle in `imports/<name>/` (`map.json`, `import.json` with its title, and `sources/`), which is not committed. The code view reads only those uploaded sources, and only for files the model shows.
- **Re-mapping:** the map lives with the project, at `docs/architecture/map.json` by default. `pull <name>` prints the map an import was last published with, and on stderr the commit that upload was built from, so `git log <commit>..HEAD` lists what changed since. `follow <repo> <map> --since <commit>` moves evidence whose cited line moved with the code, by exact text, only where one line matches.
- **Live:** `publish … --watch` stays running on the project's side and uploads again whenever its code or the map changes.
- **Provenance:** each model carries the commit, uncommitted changes and time it was built from, and the breadcrumb shows them (`3fb6d9a+ · 2 h ago`), so an old map does not pass for a current one.
- **Secrets:** a cited line's value after a key named like a password, secret, token or key is masked before upload (`password: ${DB_PASSWORD:••••}`). The source of files the model shows is uploaded as it is.
- **Access:** the service listens on this machine only, unless started with `--host`. A shared one sets `ZOOM_TOKEN`; `publish` sends the same variable, and uploads without it are refused. Uploads over `ZOOM_MAX_UPLOAD_MB` (64 by default) are refused too.

Nothing is written into the mapped repository.

## Live mode

With `npm run dev` running, any model rewritten under `public/models/` updates the open map in place, and a newly published map gets its tab:
- unchanged containers keep their exact layout;
- survivors glide to their new places, and new cards grow out of their parent;
- changed cards glow (green added, amber changed), and a toast lists what was removed;
- the camera stays on the selection, or on what is under the screen centre.

Models are rewritten when:
- a `.c4` sample under `model/` is saved;
- a project uploads a map;
- a project running `publish --watch` changes its code. New files go beside the files they reference, and a link whose evidence moved stays drawn, with a warning.

Two scripts check this end to end:
- `node scripts/live-test.mjs` edits `model/acme/model.c4` while the map is open, checks the update, then restores the file.
- `node scripts/publish-test.mjs` uploads a map of a copy of `test/fixtures/polyglot` from that copy's side, the way a project's agent does. It checks that the open viewer gets the tab without reloading, then edits the source under `publish --watch` and checks that the map follows. Finally it deletes the copy and checks that the viewer still serves its code and map.

## Controls

A few controls, each doing one thing. Press `?` or the Help button in the app for the full sheet and what the colours mean.

| Control | Does |
|---|---|
| Wheel, drag, click | Zoom at the pointer, pan, select (what it uses in amber, what uses it in cyan) |
| Double-click, `Enter` | Go into a card; on a file, open its code to read, where its part starts |
| Right-click a card | A short menu: go in or read code, copy the file's path |
| `Ctrl+K` or `/` | Search: features and parts first, then files, ranked whole name, then start, then word starts, then anywhere, letters in order last (plurals fold: "spy" finds Spies); an exact file path wins; a feature frames the cards that carry it. Empty, it lists recent places and the map's features; `>` lists commands. Finding nothing, it offers the features |
| `Backspace` or `Alt+←` | Back to the previous place, including where a wheel, drag or arrow-key trip started; `Alt+→` and the mouse buttons go forward. These are the browser's Back and Forward too |
| `Alt+↑` | Up to the parent |
| `]` / `[` | Step through the details panel's Uses / Used by rows, in its order; the camera moves only if a card is out of view; `Enter` goes there |
| `.` / `,` | Connections view only: next / previous card of the level by rank, with why it ranks there |
| `Esc` | Closes the top layer (a menu, the card stepped to), then clears the selection; it never moves the view |
| `?` | The controls sheet, a dialog |

In the Requests view an endpoint's numbered steps sit in reading order, left to right and down, with the types it names and its branches on the rows after; its panel lists the request in order, and a step opens at the lines it stands for. Cards say what they are in words: Endpoint, Step, Type, View, Response.

A first visit shows a short welcome: the map's counts (parts, files, features), how to go in, and its features as places to start. It stays until Got it. An unknown map or view says so and lists the maps there are.

The address names where you are: the selection (`at=`), else the card you are in (`in=`), the file and line being read (`file=`, `line=`) and the lens (`lens=`). A link opens there, and switching view (Architecture, Connections, Requests) keeps the subject; to and from Requests it crosses by file.

Reading a file opens it over the map in one column: native scrolling, selectable text, a header naming `path:line` with Copy and the way back to its parent, and a rail marking cited (amber) and marked (cyan) lines. Only an explicit open does this (double-click, `Enter`, Read code, a cited line); the wheel keeps zooming the map, and at its limit over a file says how to read it. A source the viewer cannot fetch says so, with Try again. Empty space offers Fit whole map.

Also: the details panel lists every relation of the selection, one line each; a line backed by a map link opens its cited code lines on click, identical lines shown once, and clicking one opens its file at that line, in the card nearest the selection; a file's panel has its path, line count, Read code and Copy path. A card too small to show its name gets a short preview on hover. Zooming past a file card shows its source (the wheel stops once it reads comfortably), coloured, with cited lines in amber and the graph's marked lines tagged with their kind. The minimap clicks and drags; arrow keys and `+` / `-` move the camera. Flights last at most 0.7 s and any press ends one; with reduced motion set in the system, the view cuts instead. Frame statistics show with `?stats` in the address.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
DPR=2 node scripts/tour.mjs                                # screenshot walkthrough into shots/tour/
node scripts/ux-tour.mjs                                   # drives every control with real input into shots/ux/
node scripts/answers-test.mjs                              # checks the map's answers: panel vs map, Back, opening code
node scripts/controls-test.mjs                             # checks the controls: dialogs, Esc, menu, motion, contrast
node scripts/place-test.mjs                                # checks places: the address, browser Back, view switch, the code reader
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
- `src/code.ts` — the code view: a file card's source, flowed into columns and scaled with the card, served by the dev server's `/source` endpoint from the uploaded sources.
- `src/live.ts`, `vite.config.ts` — live mode: model diff, layout reuse and stable child order; the dev-server watcher.
- `src/controls/` — controls: search, history, stepping through relations, context menu, previews, help.
- `model/acme/` — the realistic sample model.
- `scripts/graph.mjs` — the application file graph; `scripts/map.mjs` — map checks, the viewer model and the upload bundle; `scripts/store.mjs` — the viewer service's side: storing bundles, `index.json`, serving stored maps and sources; `scripts/zoom.mjs` — the agent's commands, including the upload; `scripts/self-import.mjs` — this repo from its map, for tours.
- `src/models.ts` — the model tabs.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
