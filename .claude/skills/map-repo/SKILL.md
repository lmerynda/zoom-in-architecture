---
name: map-repo
description: Map a codebase's application architecture into the zoom-in-architecture viewer. Use when asked to map, import, visualize or re-map a repository ("/map-repo <path>"), or to refresh a published map after the code changed.
---

# Map a repository

You turn a repository into a map that people explore by zooming: the apps that run, the parts inside them, and the files inside those, plus how they talk. The tool gives you the facts. You decide the structure.

**There is no fixed shape.** How many levels, and what each level splits by, is your call for this repository. Choose what makes it easiest to understand, using what the viewer can show (below). The rules further down are defaults that have worked on other repositories. When this repository argues for something else, follow the repository and say why in your report.

- **Facts, from code:** `zoom.mjs graph` lists the application files and every reference between them. It drops tests, build configs and dead code: whatever no entry point reaches. It keeps dev tools that have an entry point of their own (a CLI, an operator app, editor scripts), and server-side views (templates a controller renders).
- **Your job:** group files into nodes, name and describe them, list the product's features, and add the links that code references cannot show (HTTP calls, the database, queues), each with `file:line` evidence.
- **Never invent a relation between files.** The tool draws those from the graph.

All commands run from `spike/` in this repository. `<repo>` is the absolute path of the repository to map.

## What the viewer shows

- **Cards inside cards, at any depth.** Every node is a card, and its children are laid out inside it. The first view is the landscape: the top-level nodes. Zooming into a card reveals its children; a level's text is readable only while you are at that level, so each level has to make sense on its own.
- **Files are the leaves.** Each application file becomes a card titled with its name and its doc comment. Zoomed past a file card, its source code appears, syntax-coloured, with the lines the graph marked (routes, calls, stores) tagged.
- **Relations are drawn for you, at every level.** Every reference between two files (an import, a call, a controller rendering a view) is an arrow between them. Between two cards that hold those files, the arrows roll up into one, labelled with its count ("38 relations"). **How you group files therefore decides what the arrows between groups say:**
  - parts that work together a lot show one thick arrow;
  - a good split leaves few arrows between groups, and each of them means something;
  - at the bottom levels, the arrows show how the individual controllers, models, views and services connect.
- **Links cross process boundaries.** The map's links (a client calling a server, a repository writing to the database) are drawn like relations. The details panel shows each link's cited lines, and clicking one opens the code at that line.
- **Map order is reading order.** Each level is packed from the top left, in the order the map lists the nodes.
- **Size means weight.** A container with at least 10 files, and three times the median of its siblings, is drawn twice as big (2 × 2 cells). Once the map lists features, only containers that carry a feature grow, so a large pile of tooling or plumbing stays small.
- **Kinds draw differently:**
  - `actor` is a person;
  - `webapp` is a browser frame;
  - `database` and `queue` are stores;
  - `external` is a third-party system;
  - `system` is a plain group;
  - `app`, `library` (amber) and `component` are the code's own parts.
- **Search and features.** Ctrl K finds any card by its title, its id, or a feature it carries. The details panel shows a card's features as chips, and what it calls and what calls it.
- **Lenses** colour every card by size, coupling or churn (commits in the last 90 days).
- **A Requests view, beside the map.** For every app that declares endpoints, publishing also builds a second view, from code:
  - the callers, the backend and the stores on the landscape;
  - the backend's route groups, then the endpoints;
  - inside each endpoint, the request's path as numbered steps: the handler, the files its body uses, the repository that reaches the store, the view it renders, and the response.

  You write nothing for it. It reads your map for which app holds each file and for the links out to stores and services, so link each store from the files that touch it.
- **Live.** A published map re-imports when the code changes. Nodes whose ids stay the same keep their places.
- **What reads well:**
  - about 3 to 9 cards inside one card;
  - around 25 files in one card gets crowded;
  - titles are read at a glance, so keep them short and in the product's words.

## What makes a good map

- **The landscape says what the product is and what it is made of:** the people who use it, the apps that run, and the stores and services those apps use. The product comes first. Tooling that only developers use sits in a group of its own, listed last.
- **Each zoom answers the next question a newcomer would ask, in the team's own words.**
  - **Follow the repository's own split.** Most repositories already divide into folders, packages or projects that the developers think in. That may be by feature (`owner/`, `vet/`) or by layer (`controllers/`, `models/`, `views/`). A developer who knows the repository should recognise its map.
  - **Regroup only where the folders hide the product.** For example, a flat folder of 200 files, a `misc/`, or one feature scattered across ten folders.
- **Depth fits the repository.** A small service may need two levels and a large client and server game four. Add a level where it helps a reader: a card is crowded, or a part has natural sub-parts. Never add one to meet a formula.
- **The bottom levels show the code itself.** A reader who zooms all the way in sees the actual controllers, models, views and services, and the arrows between them.
- **The headline features can be found by name,** through `features`.
- **The arrows mean something at every level.** Heavy two-way traffic between two groups suggests they are one thing. A group nothing points to, and that points to nothing, suggests it belongs elsewhere.

## Steps

1. **Read the graph:** `node scripts/zoom.mjs graph <repo>`. Read all of it. It lists:
   - the projects (hints for the deployables) and the entry points, including `main` methods;
   - the config and deploy files;
   - every file with what it uses and what uses it. Named imports through a barrel (an `index.ts` that re-exports) point at the file that defines the name. Type-only imports are listed apart as `types →`: the map does not draw them, and they should not decide where a file goes;
   - under each file, the lines where it talks to another process: `route`, `call`, `store`, `queue`, `schedule`, `socket`, `message`, `process` and `file`, each with its line number. These are your link evidence.

   `--json` gives the same graph as data, with complete "used by" lists (the text caps long ones).

   Over about 300 files, start with `graph <repo> --folders`. It shows each folder with its size, its hints and the folders it references. Then read the files part by part with `graph <repo> --under <folder>`.
2. **Start from the previous map** if `imports/<name>/map.json` exists. `<name>` is the repository folder in kebab case, such as `knights-of-darkness`. Keep its ids, so the viewer morphs instead of rebuilding, and change only what the code changed:
   - `check <repo> <old map>` lists application files the old map does not place; the tree marks where neighbour votes put them;
   - `check <repo> <old map> --uncited` lists marked lines no link cites: new calls, stores and messages to link, or to leave out on purpose;
   - `audit <repo> <map>` lists files used mostly from a sibling node that use nothing in their own node: placement to review;
   - re-read the docs (step 3) for features added since. Files the old map does not place are often a new feature in a folder of its own. Give that feature a node of its own, rather than leaving its files wherever the neighbour votes put them.
3. **Find what the product is for, before you group any file.** Read:
   - the README;
   - product and design docs (feature lists, roadmaps, "what's implemented" sections, the changelog);
   - the UI's screens, menus and routes;
   - the API's route groups;
   - the CLI's commands;
   - the latest decisions: a decision log or TODO, agent instructions (AGENTS.md, CLAUDE.md), the plan index. A later decision beats an older README.

   A folder's name (`experiments/`, `prototype/`, `labs/`) never decides on its own whether something is product: what people use today does.

   Write down two things:
   - **What it is, in two sentences:** what the product does and for whom. It opens your report. Each app's description then says what that app does for the product.
   - **The headline features, 5 to 15 of them,** in the product's own words: what a user can do, or what the system does for them ("Checkout", "Live collaboration", "Export to PNG", "Turn processing").
     - Use the names the docs and the UI use, not the folder names.
     - A page or menu item people can open is a feature, however small. Technical qualities they never see (caching, logging, metrics) are not, unless the product's pitch is about them. For a starter template or a framework sample, the pitch is the stack, so what it sets up for you (a generated client, API docs) counts.
     - The core features, the reason people use the product, go first in the list.

   These features go into the map (`features`, below). When the docs name a feature and you can't find its code, search for its vocabulary (class names, routes, UI strings) before you give up.
4. **Read the code that defines the structure.** You don't need every file. Read:
   - the entry points, routers, controllers and API clients;
   - the folder layout, and how the developers split the code;
   - the config and deploy files the graph lists, for datasources, base URLs and other services.
5. **Choose the split.** Sketch the levels before you write the map:
   - What goes on the landscape?
   - What does each app divide into?
   - Where do the files sit?

   Then check the sketch against "What makes a good map". `node scripts/zoom.mjs why <repo> <map.json> <file>` shows which node holds a file, and its users and uses grouped by node. Use it to see what a grouping does to the arrows. The defaults below settle the common cases.
6. **Add the links**, one per pair of files that talk across a process boundary. Point each from the side that starts the exchange: caller to handler, client to server, writer to reader.
   - **An actor** to the app they use. Evidence is optional. Route lines that no app in the map calls are the pages people open, or an API that outside callers use. `check --uncited` lists them apart from the lines still to link; leave them. Outside callers become an actor or an `external` node only when the docs name them (partner systems, a mobile app in another repository).
   - **Calls:** from the calling file to the handling file, for example from the browser's API client to the backend controller.
     - **Which calls:** the ones the app's code makes. A generated client method that no app code calls (a health check, a test-only endpoint) is not a link, so leave its line uncited.
     - **Evidence:**
       - every `call` line and its `route` line;
       - the controller's class-level route line (such as `@RequestMapping("/kingdom")`) on each link into it;
       - the production config line that sets the client's base URL, when there is one (such as `VITE_API` in `.env.production`). When the client calls its own origin, there is no such line to cite.
     - **A generated API client** (OpenAPI or gRPC stubs) is where the calls happen. Links start at its file, citing its call lines, and the graph draws the screens → client relations.
     - **A hand-written HTTP helper:** when feature clients call a helper that does the real `fetch`, the link starts at the feature client and cites its lines; the helper is not a link end. The exception is a helper in a different app or library node from the caller. Then the link starts at the helper, where the network work happens, and the graph draws the caller → helper relation.
     - **Title:** what the calls do, or their shared path ("kingdom actions, /kingdom/*"), not a list of every endpoint.
   - **Stores:** from each file that reads or writes the store at run time (the repository, the DbContext, the files that call the ORM session) to the database node. Evidence is its `store` line plus the datasource line in the config.
     - A table or entity declaration is schema, not traffic: no link. Migrations do link, because they change the store.
     - Browser storage (`localStorage`, IndexedDB) is the browser's own, not the database, so leave those lines uncited.
     - A database chosen per profile (H2 locally, PostgreSQL in production) is one database node. Its `technology` names the engines. Its evidence cites each profile's datasource line, or for a profile with no URL (an embedded default), the lines that select it: the dependency that brings it in, the setting that picks it, or both.
   - **Queues, sockets, pipes, external APIs, launched processes and file handoffs:** the same way, from the file to the node or file on the other side. Read the code to confirm the peer: a `socket` line can be a health probe or a free-port pick, and many `file` lines are reports, not handoffs.
   - **Navigation** (`window.open`, a link to another site) is a link only when a feature depends on that site, such as exporting to a companion service. Plain links to social pages or docs are not.
   - **Timers inside the process** (`@Scheduled`, `setInterval`, BackgroundService) are not links. They belong to the node they drive, which you can say in its description. Only an outside scheduler (cron, a cloud scheduler) becomes a node with a link.
7. **Write the map**, with its `features`, to a scratch file.
   - **Check it:** `node scripts/zoom.mjs check <repo> <map.json>`, then `audit <repo> <map.json>` to review placement. `check` prints every node with its file count. Fix every error, and read every warning.
   - **Evidence warnings:**
     - Evidence in an application file should sit at one end of the link, or in a file that directly calls or is called by an end (such as the line that builds the URL a helper fetches); `check` warns otherwise. Config files can back any link.
     - A warning that evidence "is not a line the graph recognised" quotes that line, so you can see whether it is the wrong line. When the real call is a line the graph does not mark (a wrapper function, a library it does not know), cite that line anyway and leave the warning. Never move evidence to a marked line that is not the call.
   - **Publish it:** `node scripts/zoom.mjs publish <repo> <map.json>`. The viewer opens it at `?model=<name>`, and an open viewer adds its tab live.
8. **Report:**
   - what the product is, in your two sentences;
   - the levels you chose, and why they suit this repository;
   - the features, each with what carries it;
   - the number of links;
   - any feature the docs name that you could not find in the code;
   - where you departed from a default, and why;
   - anything you were unsure of.

## Defaults that have worked

### The landscape

- **The top level holds:**
  - the people who use the product. A role with screens or rights of its own (an administrator with an admin area) is its own actor. A role that only sees more of the same screens is part of one actor;
  - one node per process that runs (web app, backend service, worker, CLI);
  - the stores and external services those apps use (database, queue, third-party API);
  - shared libraries.
- **Everything only developers use goes under a `system` node,** however big it is. That covers build, test and release tools, load generators, benchmarks, local operator consoles, editor scripts, examples, experiments and prototypes.
  - Name the group plainly ("Development tools", "Experiments"), add a Developer actor, and link it to the group.
  - With no such code, there is no group and no Developer actor.
  - A group with a single tool can hold that tool's files directly.
  - A tool counts as part of the product only when users or production depend on it.
  - Any client people can use today is a product app, even one in an experiments folder or one the docs call secondary.
  - `check` warns about a top-level app that carries no feature, because that is usually tooling.
- **Order of the top level:**
  1. actors;
  2. the core app, where most headline features live. When every feature spans a client and its server, the core is the side that holds the rules and the state (an authoritative server);
  3. the other product apps. With several clients, the one carrying more headline features comes first, and the docs only break a tie;
  4. stores and external services;
  5. shared libraries;
  6. the tooling groups, last.
- **A browser UI:**
  - A client-side app (React, Vue, a page that calls an API) is its own `webapp` node, even when a backend serves its files. Link it to what it calls.
  - A server-rendered app, whose server builds the pages from templates, is one `webapp` node, holding its controllers, models and views.
- **Infrastructure that only the deployment defines** (a reverse proxy, a database admin UI, a mail catcher in a compose file) stays off the map. The exception is a component that production traffic passes through and that a reader needs to see, such as a gateway that routes between apps. That is an `external` node, with its config lines as evidence.
- **An app that only connects a client to its server** (a bridge, a proxy, a gateway) sits beside that client and carries the client's features: list it in their nodes. Never invent a feature for it.
- **Shared code:**
  - A library that two or more product apps use is a top-level `library` node. That covers a library project, and a package inside one module (Go's root domain package). Dev tools don't count toward the two.
  - A private library only one app uses folds into that app.
  - A library that one product app and some dev tools share stays a library, as a component of the shared-library node, so the tools don't appear to reach into the app.
  - A published package (a workspace package that is not `"private"`) is a top-level node however many apps use it: other people consume it.
- **Keep the libraries few:**
  - Libraries that ship together (contracts, codecs, shared rules) form one `library` node, with a component each.
  - A library of a few files goes into the library or app it is used with.
  - `check` warns about a top-level library only one app uses, one that only one product app and some dev tools use, and more than three libraries at the top level.
- **Several binaries in one module** (Go's `cmd/*`): each one users run is its own app node. A dev-only one (a storybook, a generator) goes inside the app it serves.

### Inside an app

- **Follow the repository's split:**
  - **Organised by feature** (each folder holds a feature's controller, service, entities and views): one node per feature folder, named the way the product names it.
  - **Organised by layer** (`controllers/`, `models/`, `views/`, `services/`): keep the layers as nodes, so the reader sees the split the team works in, and the arrows between layers show the request flow. Point each feature at the files that carry it across the layers.
  - **Mixed:** follow whichever split the developers use at that level.
- **Headline features stay visible.**
  - When the split is by feature, give each headline feature folder a node, titled the way the docs name it, and don't bury a feature in a broad bucket such as "World" or "Simulation" next to plumbing.
  - Features never force a split: when one folder holds several headline features (an `owner/` package with owners, pets and visits), keep the folder and let each feature name the files that carry it. Split the folder only when its card is crowded.
  - When an app serves more feature folders than fit, pair related ones under a parent named for both ("Cart and checkout"), never a generic bucket ("Core", "Players").
- **Plumbing stays small.** Connections, serialization, storage, hosting, logging and diagnostics go into a few nodes, and in a feature split they never outnumber the features.
- **Code that belongs to no feature:** when the repository's split already gives it a home (a `config/`, `system/`, `core/` or `common/` folder, or any folder the developers made for shared code), keep it there, and the entry point joins it there even when it sits in the root package. Otherwise it goes to the same places every time, so different runs agree:
  - **Startup:** the entry point, seeders, a dedicated health check, and config classes that only wire things up. A config class that sets one feature's behaviour (security rules for sign-in) goes with that feature.
  - **Shared model:** types and helpers that three or more parts use and no part owns, such as ids, shared enums, base DTOs and formatting helpers.
  - **Infrastructure with one job** (the database connection, migrations and transactions) is a small node of its own, such as "Database access". When the repository keeps the connection in its own home (a `core/` package), migrations join it there.
  - **A file that talks to an outside service** (an email sender, a payment client) is that integration's home, not a utility. It joins the other infrastructure, or is a small node of its own ("Email"), so the link to the service starts somewhere a reader would look.
  - **Utilities and other shared files:** a file several parts use goes with the part whose files reference it most. On a tie, it goes in Shared model, or with the UI kit if it is a UI component.
  - **A part's own code** (its services, interfaces and types) stays with that part, however much another part uses it.
- **Small layers:** in a layer split, a layer of one or two files sits better with its neighbour than as a card of its own. For example, the models and the CRUD functions can share a "Data" node. Keep layer nodes while they read as the steps of a request (routes → data → database). Drop them only when nearly every node would hold one or two files; the files then sit directly in the app.
- **Common shapes:**
  - **Server-side views** (Thymeleaf, Razor, Jinja and the like) go with what renders them. In a layer split they form the Views node.
    - The page layout every view wraps itself in is the app shell's. In a feature split, that is the package that holds the shared web code, such as `system/`; `audit` will list the layout, and that is expected.
    - A form fragment used by one feature only goes with that feature.
  - **In a front end,** the app shell (entry, router, layout) is one node, and each screen or group of tabs is another. API clients go with the screen they serve, and the shared HTTP helper goes in Shared model. Sign-in pages belong to the shell, unless the docs list account features (sign-up, password recovery) among the headlines; then they form a "Sign-in" node.
  - **A library's barrel** (an `index.ts` that re-exports its modules) is its "Public API" node.
  - **A generated API client** (OpenAPI or gRPC stubs) that serves every feature is one "API client" node of the app that uses it.
  - **Partial classes split by feature** (`Server.Orders.cs`) go with their feature, and the main part stays where its job puts it.
  - **A hub class that drives every feature in a client** (a game loop, a main window) belongs to the app shell. On a server, the tick or simulation that runs the product stays with the feature it runs.
  - **A set of similar content** (levels, quests, missions, recipes, report types) is split by what it is, never by an attribute such as difficulty, size, date or the alphabet. Scripted content can stay together past 25 files.
  - **Development code inside a product app** (an extra `main`, acceptance drivers, capture modes, test clocks, operator hooks) forms one node of that app, named for what it does and listed last.
  - **A small app** (under about 10 files) can hold its files directly.
- **Every application file goes in exactly one node.** Use a folder glob when a folder maps cleanly onto a node, and list files when a responsibility cuts across folders.
- **A node that has child nodes holds no files of its own.**

## Map format

```json
{
  "title": "Shop",
  "nodes": [
    { "id": "customer", "kind": "actor", "title": "Customer", "description": "Buys things." },
    { "id": "web", "kind": "webapp", "title": "Storefront", "technology": "React · Vite", "description": "Where customers browse and check out." },
    { "id": "web.checkout", "kind": "component", "title": "Checkout", "description": "Cart, address and payment steps.", "files": ["web/src/checkout/**", "web/src/hooks/useCart.ts"] },
    { "id": "api", "kind": "app", "title": "Orders API", "technology": "Java · Spring Boot", "description": "Takes and tracks orders." },
    { "id": "api.orders", "kind": "component", "title": "Orders", "files": ["api/src/main/java/shop/orders/**"] },
    { "id": "db", "kind": "database", "title": "PostgreSQL" },
    { "id": "devtools", "kind": "system", "title": "Development tools", "description": "What the team builds, tests and releases with." }
  ],
  "features": [
    { "title": "Checkout", "nodes": ["web.checkout", "api.orders"] },
    { "title": "Order history", "nodes": ["web/src/orders/History.tsx", "api/src/main/java/shop/orders/OrderController.java"] }
  ],
  "links": [
    { "from": "customer", "to": "web", "title": "shops in a browser" },
    { "from": "web/src/checkout/api.ts", "to": "api/src/main/java/shop/orders/OrderController.java", "title": "POST /orders",
      "evidence": ["web/src/checkout/api.ts:14", "api/src/main/java/shop/orders/OrderController.java:22"] },
    { "from": "api/src/main/java/shop/orders/OrderRepository.java", "to": "db", "title": "JPA",
      "evidence": ["api/src/main/java/shop/orders/OrderRepository.java:8", "api/src/main/resources/application.properties:3"] }
  ]
}
```

- **ids:** dot-separated segments. The part before the last dot is the parent node, which must exist.
- **kinds:** `actor`, `system`, `app`, `webapp`, `library`, `component`, `database`, `queue`, `external`. Files become `code` nodes on their own.
- **files:** repo paths or globs (`*` within a folder, `**` across folders). An exact path beats a glob, and a longer glob beats a shorter one.
- **features:**
  - the headline features from step 3, in the product's words, core first;
  - `nodes` lists what carries the feature: node ids (within the top three levels), or application file paths, or both. Use files when a layered app spreads a feature across layers, or when one node holds several features;
  - Ctrl K finds them, and the details panel shows them;
  - `check` refuses a feature that names neither a declared node nor an application file. It warns about a feature node deeper than three levels, and about a top-level app that carries no feature.
- **link ends:** a node id, or the repo path of an application file.
- **evidence:** `path:line` or `path:start-end` in the repo, in any file, including config.
  - Required unless one end is an actor.
  - In application code it should be a line the graph marked.
  - The viewer shows readers the cited lines (up to 8 per range) under the link, so cite the call itself, not the function around it.
- **titles and descriptions:** the user's language, not the folder's.
  - A title names what the node is or does ("Market", "Controllers"), not a path ("market/model").
  - A description is one sentence on what the node does.
  - Put the stack in `technology`.

## Done means

- `check` reports no errors, no unplaced files, and no feature or library warnings.
- The landscape shows the product first, and development tooling sits in its own group, last.
- Someone who knows the repository recognises its split in the map. Where you departed from it, your report says why.
- Every headline feature from step 3 is in `features`, and a reader who knows only the product's pitch can find each one by name.
- Zooming in, someone new can answer "where does X happen, and what does it call?" for the main features, down to the individual files.
- No card is crowded past about 9 child cards or 25 files, unless your report says why.
