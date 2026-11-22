# Does the viewer show first what its user wants first? 2026-11-22

Two independent reviews, by Codex (gpt-6.2-astra, xhigh) and Fable 5.2, of main at `664c643`. Both drove the running viewer (knights-of-darkness, petclinic, rw-golang-gin, fastapi-template; cold opens of excalidraw and galaxy-wars) against one question from the owner: for a web app in the agentic era, the user wants first **what endpoints there are** and **the general architecture, where the connections are**; implementation is secondary. Full reports and screenshots were working files and are not committed.

Caveat both noted: only knights-of-darkness carries the rebuilt Requests model (published locally after the builder fixes); the other maps' Requests views are older uploads.

## Verdict

Both: **half way.** The first screen answers "what is this system and what does it connect to" well: people, apps, stores and external systems as cards with plain descriptions, in seconds. After that the order inverts. The default view does not know the system's surface exists: no endpoint count on the backend card, none in its panel, endpoints not even findable by search outside the Requests view. The surface lives in a separate tab that opens on another landscape, split over groups that never fit one screen (knights-of-darkness: 67 endpoints, 10 groups, 6 sub-groups; Codex counted 35 gestures to visit every group). One level into an app, file cards and code thumbnails arrive before anyone asked.

**Biggest gap (both):** no single place to read the system's surface as a list, beside the map.

## Ranked findings, merged

Both = both reviewers raised it. Effort S under a day, M a few days, L a week or more.

1. **No endpoint inventory where you start (P0, both, M).** A searchable list of every endpoint (method, full path, handler, stores reached, callers), grouped by resource with recursive counts, beside the map and reachable from the default view. Each row opens the request path. Today: Requests tab → backend → group → sub-group, never all on one screen (`requests.mjs:124-130`, the outline lists one level).
2. **The client → API link is wrong in the view about HTTP (P0, both, S then L).** In Requests the client's calls are pushed without kind or evidence, so they draw grey "uses in code" (`requests.mjs:233`, `model.ts:126`); they land on the handler step card, so the client's Uses read as Java method names ("1 · buyOffer()…"); and the store's Used by is 30-odd copies of "4 · KingdomJpaRepository" with no endpoint named (`requests.mjs:226`). Fix now (S): runtime kind with the map link's evidence, target the endpoint card, list a store's users as endpoints grouped by table. Later (L): which **page** calls which endpoint, by matching method and path through the client's API wrapper (buy is called from `Market.tsx:45` and `Alliance.tsx:443` via `api/endpoints.ts:123`).
3. **Boundary arrows do not say how the call is made (P1, both, M).** Folded runtime links read "×15"; the mechanism needs a click. Label crossings with transport first, count second: "HTTP ×10", "JPA → PostgreSQL". Needs a `via` on map links (skill, check, render). Also tells local SQLite apart from a network hop (Gin).
4. **The default view carries no surface (P0 Fable, both, M).** App cards and panels should state their surface ("67 endpoints · 1 scheduled job"; client: "12 pages · calls 62 endpoints"). A controller's panel should lead with **Serves** (its routes, from `marks`, each a link into the request path), not its 15 DTO imports.
5. **Search and view switches lose the subject (P0/P1, both, S-M).** "POST /market/{id}/buy" finds nothing in Architecture; switching to Requests from a component reopens the whole landscape. Index endpoints (and marked routes) in every view; choosing one crosses to Requests; carry component and feature scope across views.
6. **An endpoint is told as files, not effect (P1, both, M).** Buy: eight file thumbnails around one response card; types before stores and callers in the panel. Lead with **takes / reads and writes / returns / auth / called by**, with the numbered steps one expand away ("Implementation steps"); collapse interface + JPA pairs into one effect ("reads kingdoms"). Keep the response's generic type (`ActionResult<MarketPurchaseDto>` is shown as `ActionResult`, `model.ts:72`/`:102` strips it as markup) and evidenced status branches (401).
7. **Trace honesty (P0 Codex, L).** A trace that stops must say so ("trace ends at IMarket"): knights `POST /market/create` shows no store though `Market.java:76` writes one. Older generated traces should be flagged as such. An honesty line on the inventory: "72 routes marked, 67 placed" (Fable).
8. **Implementation arrives too early (P1, both, S).** Code thumbnails below reading size carry nothing (Market: 21 previews before its five HTTP operations); import trunks (×38, ×72) dominate inside an app; in galaxy-wars the heaviest landscape lines are imports of shared contracts (×405) beside thin runtime links. No thumbnail until a line is readable (role badge and first doc line instead); runtime arrows always heavier than code uses; sibling code-use arrows faint until a card is in focus.
9. **"Connections" answers a different question (P1, both, S).** It is a coupling layout (ranks Development tools #2 ahead of Game client in knights). Rename to **Coupling** and make it a layout option; runtime connections belong in the overview.
10. **Surface is more than HTTP (P1, both, M-L).** Jobs (knights' BotClock; galaxy-wars' 23 schedules), sockets (21 in galaxy-wars, whose real session runs over a WebSocket bridge), message handlers, CLI commands, exported APIs and pages are peers of endpoints. Seed an **Entry points** list per app from existing `marks`; name the surface tab for the app's kind.
11. **The welcome counts the wrong things (P2, both, S).** "6 parts, 261 files, 19 features… double-click a file" → a product sentence and "2 apps, 1 database, 67 endpoints, 19 features", with **See the API** beside the feature chips; control tips move to Help.
12. **Features and endpoints never meet (P2, both, M).** The Market chip says "Market: Market, Market" and selects a 21-child component. A feature should show its pages, its endpoints and their data effects together.
13. **Smaller (Fable):** the Requests landscape opens closed and two-thirds empty (open inside the backend); tooling (Development tools) gets the product's billing and doubles every caller list (collapse to a chip, out of counts); the outline orders by busyness (order by role: people, apps, stores, externals, tooling); Requests drops the people ("Used by · 0" where staff use the app as a whole).

## The first screen both propose

**Overview** as the default, for every map:
- **Left, the runtime landscape:** people and clients → apps → stores and external services, left to right; tooling collapsed to one row or chip. Every arrow at this level is a boundary crossing labelled by transport and count. Code-import arrows between top-level parts are off until asked.
- **Right, the surface:** **Endpoints · 67**, grouped by resource, filterable by method, caller and store; then pages, jobs and other entry points; then a **Connections** list (one row per boundary link: from, to, via, count, cited lines); then features.
- **Clicks:** an endpoint keeps the landscape still, lights the crossings it uses, and opens its effect summary (callers, data touched, response branches, unresolved parts said plainly); an app filters the list; a crossing lists its operations and evidence; a feature filters both. Go inside, Implementation steps and Read code keep today's zoom, numbered lane and reader.
- **Hidden until asked:** files, thumbnails below reading size, import arrows, type-only imports, ranks, churn.

## Where the thesis needs qualifying

- **Entry points, not endpoints.** HTTP is one kind; a game's protocol and tick, a CLI's commands, a library's exports, a pipeline's triggers and sinks are the same question: what can someone do here, across which boundary, to whose data.
- **Data belongs first too.** Which tables exist and what writes them ranks with endpoints for someone reviewing agent work.
- **Features are how a lead talks** ("change Market"): features → entry points → code is the path, so features and endpoints must meet.
- **Review time needs a diff.** For a user who directs agents, "what changed since this revision" (a new endpoint, a new crossing, a new dependency between components) may outrank every static view; both reviewers flagged it.
- **Internal structure is not all implementation.** An import from War into Market is an architecture finding: demote code-use arrows at rest, do not remove them.
- **A surface-first view hides omissions.** A missed route is simply absent, so the list needs its honesty line.

## Suggested order

1. Requests builder fixes from finding 2 (runtime kind and evidence on caller links, caller → endpoint card, store users by endpoint): S, data only.
2. The endpoint inventory in the panel, with cross-view search for endpoints (1, 5).
3. Transport labels on crossings (3).
4. Surface on the default view: counts on app cards, Serves in panels (4); welcome counts (11).
5. Effect-first endpoint panel and trace honesty (6, 7); thumbnails gated, runtime arrows heavier (8).
6. Coupling rename (9); entry points beyond HTTP (10); feature ↔ endpoint (12).
7. Then: the Overview layout as the default; a "changed since" overlay.

Each step ships with its black-box scenario. Acceptance for 1-2 (Codex): from a cold knights-of-darkness map, list all 67 routes in one action, select buy, name both calling pages and the response type, and tell proven store effects from unresolved ones before opening code.
