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

## Real codebases: a file graph from code, the structure from an agent

**The first importer mapped folders, not architecture.** It built system → top folder → project → folder → name cluster → file from manifests and paths. That shows how the files are stored, not what the application does, and it included every config file. On a standard frontend repo, `eslint.config`, `playwright.config` and the like took up a large part of the map. Folders are the wrong source for structure.

The importer is now split along what each side is good at:
- **Code supplies the facts** (`scripts/graph.mjs`, deterministic):
  - **Which files are the application.** JS/TS is what an entry point reaches through imports. C#, Rust and Java are what a non-test project compiles. Entry points are `index.html` scripts, package entries, `node <file>` npm scripts and `main` methods. Tests, build configs and dead code drop out with no ignore list.
  - **Every reference between those files.**
  - **The lines where processes meet:** routes, outbound calls, stores, schedules, sockets, process launches and file handoffs.
- **An agent supplies the meaning** (the [map-repo skill](../../.claude/skills/map-repo/SKILL.md)):
  - It groups files into processes and components by responsibility, and names and describes them.
  - It links what code references cannot see, such as browser API client → controller, or repository → database.
  - `check` holds it to the facts. Every application file must be placed. Every link needs `file:line` evidence that exists, and evidence that misses a marked line is quoted back. Relations between files come only from the graph.
  - The details panel shows each link's cited lines, copied into the model at publish time, so a reader can judge a link without opening the repository.

**Pilot: Knights of Darkness** (React + Vite browser client, Java Spring Boot backend; 256 source files). A fresh agent that knew only the skill mapped it:
- **The graph:** 211 application files and 649 references, in 0.9 s. Left out were 42 test files, plus the two eslint configs and `vite.config.ts`, which no entry point reaches.
- **The map:**
  - Player, Game client, Game server and Game database at the top.
  - 8 client components and 9 server components below them, by domain: Market, Alliances, Kingdom (with five sub-components), Bots and so on.
  - 9 HTTP links from each API client to its controller, and 9 repository → database links.
  - It took about 4 minutes, and `check` passed on the first run.
- **In the viewer:** layout takes 202 ms, and frames take 0.5 ms p50 / 1.1 ms p95.

What it taught:
- **Reachability from entry points is the right filter.** It needs no ignore list, and it also catches dead code.
- **The agent needs the seams as facts, not as a search task.** In the first run it grepped for routes and `fetch` calls by hand, and evidence could point at the wrong line unnoticed. Its friction report drove the hints, the config-file list, the per-node file counts in `check` and the evidence check. Re-checked against those, all 19 of its links land on marked lines.
- **Line evidence drifts.** Editing `map.mjs` moved lines that this repo's own map cited, and the evidence check caught it. Live re-publishes treat drift as a warning, so the map stays up while the code moves.
- **A real bug surfaced as a dependency.** Notifications → Market exists only because a copy-pasted logger names `MarketController`. The map is faithful to the code, which makes such slips visible.
**Pilot 2: a private game codebase** (a C# server and tools, a Unity client, a Rust/Wasm browser client and its relay, browser experiments; 1,300 source files). A fresh agent took about 13 minutes and produced:
- **The graph:** 660 application files and 3,235 references. Left out were 599 test files and the art scripts no entry point reaches.
- **The map:** 78 nodes and 32 links: WebSocket and TCP game connections, HTTP to the operator API, PostgreSQL, named pipes, launched processes and file handoffs.
- **In the viewer:** 738 elements, layout in 403 ms, frames 0.9 ms p50 / 1.9 ms p95.

What the larger repo taught:
- **A false dependency is worse than a missing one.** Unity code was resolved against every C# project by bare type name, which gave 114 false edges into the dev tools and the server, including `UnityEngine.Rect` matching a private nested `struct Rect`. Unity now sees only the projects its `Packages/manifest.json` names as `file:` packages, and nested or private types never resolve from another file (C# and Java).
- **Real front ends hide their entry points.** The maintained browser client loads its modules from an inline `<script type="module">`, and reaches its Rust crate through wasm-pack output (`pkg/<crate>.js`) that isn't in git. Pages anywhere in the repo now give entry points, an inline-module page is itself an application file, `pkg/<crate>.js` resolves back to the crate, and worker and service-worker paths are followed from the page's web root.
- **The hints must learn each stack's seams.** This pilot added named pipes, HttpClient calls on a base address, `app.Map`, static-file hosting, `ProcessStartInfo`, Rust sockets and Npgsql. Unrecognised evidence lines fell from 24 to 12. The remainder are project-specific wrappers, which the skill now says to cite anyway.
- **Large graphs need paging.** The full listing was 170 KB, and one file's uses ran to several kilobytes. `--folders` gives a 10 KB overview, `--under <folder>` pages through the rest, and use lists are capped.
- **The agent needs placement rules, not just a format.** The skill now says when a shared library is its own node (used by two or more apps), when a small app needs no components, how `system` groups experiments, and which way links point.

**Pilot 3: Excalidraw** (open source; a TypeScript monorepo of seven published packages, the web app and two example apps; 1,328 files). An agent mapped it in about 9 minutes, and a second agent re-mapped it from that map after the tool changed:
- **The graph:** 507 application files and 3,453 references, 525 of them type-only. Left out were 164 test files, the build, release and stats scripts, the docs site and dead components.
- **The map:** 87 nodes and 34 links: the collaboration socket, Firestore and Firebase Storage, browser storage, the JSON and AI backends, the library site, Excalidraw+ (window.open and postMessage), a font-subsetting worker, Sentry and analytics.
- **In the viewer:** 594 elements, layout in 268 ms, frames 0.8 ms p50 / 1.3 ms p95.

What a library monorepo taught:
- **Type-only imports point the wrong way.** `import type` from the editor package made the base libraries look like they depend on it, a cycle that does not exist at runtime. Type-only edges are now marked, listed apart, and not drawn. The layering now reads editor → element → common and math.
- **Barrels swallow relations.** Every import from `@excalidraw/common` landed on its `index.ts`. Named imports now follow `export … from` chains to the defining file, and re-export edges are tagged so a barrel does not count as a user.
- **Monorepos hide apps and tooling in the same places.** The example apps were dropped as tests, and npm build, release and stats scripts counted as entry points. Examples now count as apps, those scripts no longer start the graph, and manifests with no application code are listed with the reason.
- **Re-maps need their own tools.** The re-map kept every id and agreed with the first map at 0.98. That figure leaves out the 12 files the first map never placed; including them would skew it. `check --uncited` lists marked lines no link cites, `audit` lists files used mostly from a sibling node, and `why` takes several files. Before these, the agent diffed graph outputs by hand.

**Pilots 4 and 5: Python and Go.** The graph learned both languages, then two open-source repositories tested them, each mapped by a fresh agent.
- **The FastAPI full-stack template** has a Python FastAPI backend and a React frontend: 102 application files and 310 references. Its map links the generated TypeScript SDK to the three Python route files, with call lines, route lines and the `/api/v1` prefix as evidence. The API links to PostgreSQL, SMTP and Sentry.
- **WTF Dial** is a Go service with a CLI: 36 files and 148 references. The server's components split by feature, a root domain package serves both binaries, and the links cover GitHub OAuth, SQLite, Let's Encrypt and Rollbar.

What two more languages taught:
- **Go hides dependencies in generated and embedded files.** Template code generated by `go generate` is gitignored, so imports of that package resolved nothing and its component looked orphaned. Scripts embedded with `//go:embed` looked dead. Imports now reach a package even when only generated code declares the name used, and embeds count as reachability. Build-tag variants are all drawn, and `tools` build files drop.
- **Python finds code by convention, so packages count whole.** Entry points are the FastAPI or Flask app module, `__main__` guards, `manage.py`, wsgi/asgi and alembic's `env.py`. Scripts only CI runs are tooling.
- **The ORM marks are where the database is used.** Hints now mark `session.exec/add/commit`, Go `tx.Exec/Query`, router prefixes (`APIRouter`, `include_router`) and the paths of decorators split over two lines.
- **A watcher must survive a half-written file.** Publishing wrote `source.json` in place, and the dev server read it mid-write and crashed. Writes are now atomic, and the watcher skips a file it can't read yet.

**Stability across runs.** Seven fresh agents mapped Knights of Darkness, and `zoom compare` scored each pair. It uses the adjusted Rand index of how files are grouped, because node ids differ between runs; 1 is identical and 0 is chance.

| Pair | Processes | Leaf groups | HTTP links |
|---|---|---|---|
| Two runs on the same skill | 1.00 | 0.84 | 9 of 9 the same |
| Two runs after tightening the skill | 1.00 | 0.90 | 9 of 9 the same |
| Two runs on the next round of rules | 1.00 | 0.95 | 9 of 9 the same |
| Runs across skill versions | 1.00 | 0.81–0.91 | 9 of 9 the same |

- **The top level and the links never varied.** Every run found the same processes, the same 9 HTTP links and the same 9 store links.
- **Feature components mostly match exactly:** Market, Alliances, Bots, Notifications, Sign-in.
- **Disagreement sits in judgement calls:**
  - how a large component splits (which child gets each entity);
  - where code that belongs to no feature goes (wiring, seeders, utilities, shared enums);
  - front-end shell boundaries.
- **Explicit placement rules remove it where they apply.** After the skill named Startup, Shared model and the app shell, both runs placed those identically. The next round gave one more rule each to config classes, files shared by several features, entities in a split and base-URL evidence, and agreement rose to 0.95. In the last pair, 17 of 23 groups match exactly. What still differs is a few entities among Kingdom's sub-components, and part of Shared model.
- **Agents read conflicting rules the same way.** Both latest runs found that "goes with the feature that references it most" clashed with keeping a feature's own interfaces. They resolved it identically, and the skill now says so. Both also wrote scripts to count who uses a file; `zoom why` now does that.
- **Reruns start from the previous map,** so a live repository keeps its ids. The variance matters for a first map, not for updates.

- **Kept from the first importer:** labels fitted by natural width (real class names overflowed), and the reference resolvers. LikeC4 is out of the import path, which removes the keyword-collision problem: generated models go straight to the viewer's JSON.

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

All of these were driven with real mouse and keyboard input by `scripts/ux-tour.mjs`, and recorded by `scripts/record.mjs acme-controls`. Driving them found three real bugs:
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
  - Re-importing a large codebase with no code change redid 0 of 94 layouts, and the swap took 25 ms.
- **All writers use one path.** The dev server watches `public/models/`, so the sample extractor, an agent's publish and a live re-publish all reach open viewers the same way. Writes are atomic (temp file, then rename), so a viewer never reads half a file.
- **Child order is stable.** Rectpacking places children in input order, so the first version inserted the new service first and reflowed every sibling; the selected card jumped 300 px. Laying out children in their previous order, with new ones appended, keeps siblings in place as far as the packing allows.
- **The camera holds still.** It is anchored on the selection, or on what is under the screen centre, and moves with it during the morph. In the test the selected card stayed exactly in place (0 px).
- **The update is fast.** It lands 0.7–0.9 s after saving a .c4 file: extraction is about 0.4 s, the swap about 0.2 s. A source edit in a mapped repository re-publishes in about 1.5 s; new files go beside the files they reference.
- **State carries over.** Selection, target, route, pins, bookmarks and history all follow the new version. They are keyed by element id, not index; history and bookmarks used to store indices, which would have broken across versions (and across page reloads after an edit).

Two environment lessons:
- Vite's watcher does not report files outside its module graph, such as the .c4 sources. The plugin uses Node's recursive `fs.watch` instead.
- The plugin must not start under Vitest, or the test run cannot exit.

## Visual identity

- **Every card says what it is.** An icon before the title is picked from the shape (person, database, queue, browser, phone), then from the kind's name. Sample vocabularies such as `service`, `softwaresystem` and `existingsystem` find theirs without a mapping table.
- **People and the outside world look different.** Actors get rounder cards. External systems are outlines with no shadow, since they sit outside what was mapped.
- **Big parts read as big.** A container holding at least 10 files, and 3 times its siblings' median, spans 2 × 2 cells, at every level. Actors, stores and external systems stay one cell, so a web app no longer looks the same size as an analytics service. The span is part of the layout job's key, so a live update re-lays a container only when a child crosses the threshold.

## Zooming into code

Past a file card's last level comes the file itself. Once the card is 640 px wide, its whole source fills the card's lower part, flowed into as many columns as make the text largest. At first it reads as a minimap of the code, and it becomes readable as you keep zooming, with no mode switch. The code is coloured (comments, strings, numbers, keywords, type names) by a small line scanner for the languages the graph reads, with no dependency. Lines that links cite are highlighted in amber, and lines the graph marked (routes, calls, stores, sockets…) get a cyan edge and their kind, so the seams an agent should cite are visible where they sit. This also fixed empty full-screen leaves: a file zoomed to fill the screen used to be blank below its dossier.
- **The dev server serves the source** at `/source/<model>?path=…`, read from the mapped repository. It serves only paths the published model lists as files, resolved inside that repository, up to 1 MB. A static build has no source, and cards stay as they were.
- **Far out it is a drawn minimap, closer in it is text.** Below a 6 px font the file is a canvas of coloured token bars, drawn once per file. From 6 px it is a scaled `<pre>` holding only the lines in view plus half a view of margin, re-rendered only when the view leaves them; zooming in never re-renders. Tokenizing, markup and the minimap are prepared in 600-line slices between frames as soon as the card asks for the file, while it is still too small to show. A long file's columns are centred in the card, so zooming in on the card's middle lands on code.
- **Measured on Excalidraw's 11,499-line `App.tsx`**, zooming 300× from the overview into reading, warm and cold: 16.7 ms p50 and 17 ms p95 frames, worst 24 to 35 ms, at most 272 lines in the page at the deepest zoom. The first view used to cost one 220 ms frame.

## A newcomer pass

A scripted newcomer answered two questions on real maps with real input only (wheel, clicks, keys): where Excalidraw saves scenes to Firebase, and how the FastAPI template's frontend logs in. Travel and the panel worked at once: typing "firestore" finds the store, and its panel names `firebase.ts:207`. What got in the way, all fixed:
- **Clicking the card you just travelled to deselected it**, hiding the panel you were reading. Clicking the selection now keeps it; Esc or empty space clears.
- **A file you travel to was a blank box.** Code only showed from 640 px wide, and travel frames a file at about 470 px. It now shows from 280 px, so you arrive at a minimap of the code.
- **The wheel had no floor to stop on.** Six notches past arrival, line numbers were 40 px; thirty notches reached ×2.5·10⁸ and an empty screen. Over a file the wheel now stops when its code is 28 px, or when a file without code is a screen and a half wide; containers still zoom freely.
- **Evidence was a dead end.** A cited line now opens its file there: clicking `firebase.ts:66 ↗` flies to that line, readable and centred beside the panel, and Backspace comes back.
- **Tooltips covered the code**, staying locked under a still cursor while you wheeled, and coming back once you stopped. Wheeling closes them, and none show for a card that fills the screen.

## Maps lead with the product

A re-map of a large private client and server repository showed the skill capturing the code's shape but not the product's essence. Three things went wrong:
- **Development tooling sat beside the product.** Build tools, a headless test client, a profiler and an operator console were top-level peers of the server, and the biggest of them were drawn as large as the server.
- **Headline features had no node.** A feature added after the first map landed in its own folder, and neighbour votes split its files between two unrelated components, one of them hosting. Other features were buried in broad buckets next to plumbing.
- **Content was split by an attribute.** Authored levels were divided by difficulty rather than by what they are.

The cause: the skill built the map bottom-up from the graph and the folders. Nothing asked what the product does, and nothing checked the result against it. The fixes:
- **Features are part of the map.** The skill now starts by reading the README, docs, screens and routes for what the product is and its 5 to 15 headline features, and the map lists them with the nodes that carry each one. `check` refuses a feature that names an undeclared node. It warns when a map has no features, when a feature sits more than three levels down, and when a top-level app carries no feature: the last one is how tooling gets caught.
- **Product first, in reading order.** Tooling and experiments go in `system` groups listed last. The core app comes first, since the viewer packs each level from the top left in map order. Plumbing comes after the features inside each app.
- **Size is earned by features.** In a map with features, only cards that carry one grow to double size. A tooling group or an infrastructure component with a hundred files now stays one cell.
- **Features are searchable.** Ctrl K matches feature names, so a phrase that appears only in a feature still finds the nodes that carry it, and the details panel shows the features as chips.

Re-mapped under the new skill, the same repository opens on its server top left, with the feature components ahead of a single infrastructure component. Development tools and experiments are small cards at the edge. Every feature has a node, and the check is clean with every file placed.

## Fixed rough edges

- **A crash mid-publish:** a publish cut off by a shutdown once left a file of NUL bytes under its real name, and that import stopped republishing. Writes now flush to disk before the rename that puts them in place.
- **First view of a very large file:** building a 10,000-line file's markup when it first appeared cost one frame of about 220 ms. It is now prepared in slices before it shows, and only the lines in view are in the page.
- **Empty full-screen leaves:** a file zoomed to fill the screen now shows its source (see Zooming into code).
- **Exits through the header:** routes used to enter and leave containers through their top, crossing the header band. A card with a header now has no top port, so lines come in from the sides or below.
- **Trunk arrowheads:** a line leaving a shared trunk could look like an edge from the card beside it. Branch points now get a dot, and plain crossings do not.
- **Shrinking technology lines:** a long kind and technology line used to shrink to fit its card. It now stops at a readable size and is cut with an ellipsis; the details panel has the whole line.

## Known rough edges

None open from the passes above.

## Not verified

- Integrated or low-end GPUs, Safari and Firefox, touch and pinch.
- Interaction feel: judged from frame intervals and screenshots, not by a person scrolling.
- Large real models: 10k is synthetic, with random, dense relations.
- Map quality on repositories other than the two pilots; stability was measured on one repository only.
- The feature-first skill with a cold agent: the re-map above was done in the session that wrote the rules, starting from the old map.

## Recommended next steps

1. Get a person to drive it with real models and note where it confuses. The design now needs human feedback more than more code.

Screenshots: `node scripts/tour.mjs` writes the walkthrough into `spike/shots/tour/` (not committed).
