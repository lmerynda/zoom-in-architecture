---
name: map-repo
description: Map a codebase's application architecture into the zoom-in-architecture viewer. Use when asked to map, import, visualize or re-map a repository ("/map-repo <path>"), or to refresh a published map after the code changed.
---

# Map a repository

You turn a repository into an architecture map: the apps that run, the components inside them, and the files inside those, plus how they talk. The tool gives you the facts. You give them structure and meaning.

**A map shows the essence of the product first.** Someone opening it should see what the product is and what it does before they see how it is built or tested. The graph tells you how the code hangs together, but not what matters. Work that out from the product's own docs and screens, then build the map around it:

- the product's apps go on top, and its development tooling goes into a group of its own;
- each headline feature gets a component named as the product names it;
- plumbing such as connections, storage, hosting and serialization stays small.

- **Facts, from code:** `zoom.mjs graph` lists the application files and every reference between them. It drops tests, build configs and dead code: whatever no entry point reaches. Dev tools with an entry point of their own (a CLI, an operator app, editor scripts) stay. They are part of the system, but not of the product: a separate dev-tool project is its own app inside the tooling group, and development code inside a product project is a component of that app (step 5).
- **Your job:** group files into components by responsibility, name and describe them, and add the links code references cannot show (HTTP calls, the database, schedulers), each with `file:line` evidence.
- **Never invent a relation between files.** The tool draws those from the graph. A component's relations are rolled up from its files.

All commands run from `spike/` in this repository. `<repo>` is the absolute path of the repository to map.

## Steps

1. **Read the graph:** `node scripts/zoom.mjs graph <repo>`. Read all of it. It lists:
   - the projects (hints for the deployables) and the entry points, including `main` methods;
   - the config and deploy files;
   - every file with what it uses and what uses it. Named imports through a barrel (`index.ts` re-exports) point at the file that defines the name. Type-only imports are listed apart as `types →`: the map does not draw them, and they should not decide where a file goes;
   - under each file, the lines where it talks to another process: `route`, `call`, `store`, `queue`, `schedule`, `socket`, `message`, `process` and `file`, each with its line number. These are your link evidence.

   `--json` gives the same graph as data, with complete "used by" lists (the text caps long ones).

   Over about 300 files, start with `graph <repo> --folders`: each folder with its size, its hints and the folders it references. Then read the files part by part with `graph <repo> --under <folder>`.
2. **Start from the previous map** if `imports/<name>/map.json` exists (`<name>` is the repo folder in kebab case, such as `knights-of-darkness`). Keep its ids, so the viewer morphs instead of rebuilding, and change only what the code changed:
   - `check <repo> <old map>` lists application files the old map does not place, and the tree marks where neighbour votes put them;
   - `check <repo> <old map> --uncited` lists marked lines no link cites: new calls, stores and messages to link, or to leave out on purpose;
   - `audit <repo> <map>` lists files used mostly from a sibling node that use nothing in their own: placement to review under the rules in step 5.
   - Re-read the docs (step 3) for features added since. Files the old map does not place are often a new feature in a folder of their own. Give that feature a component; don't leave its files wherever the neighbour votes put them.
3. **Find what the product is for, before you group any file.** Read:
   - the README;
   - product and design docs (feature lists, roadmaps, "what's implemented" sections, the changelog);
   - the UI's screens, menus and routes;
   - the API's route groups;
   - the CLI's commands;
   - the latest decisions: a decision log or TODO, agent instructions (AGENTS.md, CLAUDE.md), the plan index. A later decision beats an older README.

   A folder's name (`experiments/`, `prototype/`, `labs/`) never decides on its own whether something is product: what people use today does.

   Write down two things:
   - **What it is, in two sentences:** what the product does and for whom. It becomes the main app's description, and the opening of your report.
   - **The headline features, 5 to 15 of them,** in the product's own words: what a user can do, or what the system does for them ("Checkout", "Live collaboration", "Export to PNG", "Turn processing"). Use the names the docs and the UI use, not the folder names. Mark the few that are the core, the reason people use the product.

   These features go into the map (`features`, below), and each one must point at a node that carries it. When the docs name a feature and you can't find its code, search for its vocabulary (class names, routes, UI strings) before you give up. Never drop a headline feature because its code is spread across folders.
4. **Read the code that defines the structure.** Not every file:
   - entry points, routers, controllers and API clients;
   - the config and deploy files the graph lists, for datasources, base URLs and other services.
5. **Design the levels:**
   - **Product first.** The top level holds:
     - the people who use the product;
     - the apps that serve them;
     - the stores and external services those apps use;
     - shared libraries.

     Everything only developers use goes under a `system` node, however big it is: build, test and release tools, load generators, benchmarks, local operator consoles, editor scripts, examples, experiments and prototypes. Name it plainly ("Development tools", "Experiments"), and link the developer actor to it. A tool counts as part of the product only when users or production depend on it. Any client people can use today is a product app, even one that lives in an experiments folder or that the docs call secondary: list it after the main client, and give it the features it serves. `check` warns about a top-level app that carries no feature, because it is usually tooling.
   - **Order is reading order.** The viewer packs each level from the top left, in the order the map lists its nodes. At the top level, list them in this order:
     1. actors;
     2. the core app, where most headline features live. When every feature spans a client and its server, the core is the side that holds the rules and the state (an authoritative server); a client that renders and sends input comes next;
     3. the other product apps;
     4. stores and external services;
     5. shared libraries;
     6. the tooling groups, last.

     Inside a node, list the core features first, then the supporting features, then the plumbing (Startup, Shared model, Database access).
   - **Top level:** actors (who uses it), one node per process that runs (web app, backend service, worker, CLI), and stores and external services (database, queue, third-party API).
     - A browser UI is its own `webapp` node, even when a backend serves its files; link it to what it calls.
     - **An app that only connects a client to its server** (a bridge, a proxy, a gateway) sits beside that client and carries the client's features: list it in their nodes. Never invent a feature for it.
     - **Shared code:** a library project, or a package inside one module (Go's root domain package), that two or more product apps use is a top-level `library` node. Dev tools don't count as users: a library one product app and a profiler use folds into that app's components. So does any private library a single app uses. A published package (a workspace package that is not `"private"`) is a top-level node however many apps use it: other people consume it.
     - **Keep the libraries few:** libraries that ship together (contracts, codecs, shared rules) form one `library` node with a component each, such as "Shared contracts". A library of a few files goes into the library or app it is used with. `check` warns about a top-level library fewer than two product parts use, and about more than three at the top level.
     - **A library's barrel** (the `index.ts` that re-exports its modules) is its "Public API" component.
     - **Several binaries in one module** (Go's `cmd/*`): each one users run (a server, a CLI) is its own app node; a dev-only one (a storybook, a generator) is a component of the app it serves.
     - **A generated API client** (OpenAPI, gRPC stubs) that serves every feature is one "API client" component of the app that uses it, and its file is where call links start.
     - **A package that holds both a server's handlers and that server's own client** goes with the server. The client app's link starts at its command file, and the client code in the shared package is supporting evidence.
   - **Inside each process:** 3 to 9 components by responsibility, such as Market, Alliances, Turn processing or Sign-in. Prefer the domain over the technical layer: Market holds its controller, service, entities and DTOs. Dev-tool components (below) don't count toward the 9.
     - **Each headline feature the process serves is a component,** or a child of one, titled the way the docs name it. When its files are spread across folders, list them. Don't bury a headline feature in a broad bucket such as "World" or "Simulation" next to plumbing.
     - **More features than fit:** when a process serves more headline features than 9 components hold, pair related features under a parent named for both, the way the product pairs them ("Cart and checkout", "Orders and returns"), never a generic bucket ("World", "Players", "Core").
     - **Plumbing stays small.** Connections, serialization, storage, hosting, logging and diagnostics go into a few components, and never outnumber the features. A component that is half plumbing and half feature should be split.
     - **Split a set of similar content by what it is,** not by an attribute such as difficulty, size, date or the alphabet. Content means levels, quests, missions, recipes, migrations or report types. Usually that is one component for the content, with a child for the engine that runs it. Scripted content stays together past 25 files: split it only by what it is.
   - **Code that belongs to no feature** always goes to the same places, so different runs agree:
     - **Startup:** the entry point, seeders, a dedicated health check, and config classes that only build beans or wire services. A health check in a feature's router file stays with that feature. A config class that sets a feature's behaviour (security rules, CORS for sign-in) stays with that feature;
     - **Shared model:** types that three or more features use and no feature owns (ids, shared enums and names, base DTOs);
     - a utility goes with its main user, or in Shared model when most features use it. Count users by the components directly inside the process, not by deeper children;
     - the domain's own rules and configuration are a feature like any other ("Game rules"), not a home for leftovers;
     - **partial classes split by feature** (`Server.Orders.cs`, `Store.Payments.cs`) go with their feature; the main part stays where its job puts it (connection handling, the store);
     - **a hub class that drives every feature in a client** (a game loop, a main window) belongs to the app shell, such as "Main loop and session". On a server, the tick or simulation that runs the product stays with the feature it runs, not with the plumbing;
     - **a file with no feature of its own** that several features use goes with the feature whose files reference it most. On a tie, it goes in Shared model, or in Startup if it is configuration. A feature's own code (its services, interfaces and types) stays with that feature, however much another feature uses it.
     - **Infrastructure with one cohesive job** (the database connection, migrations and transactions) is its own small component, such as "Database access", not pulled into whichever feature uses it most.
     - `node scripts/zoom.mjs why <repo> <map.json> <file>` shows which node holds a file, and its users and uses grouped by node. Use it instead of counting by hand.
   - **In a front end,** the app shell (entry, router, layout, sign-in pages) is one component, and each screen or group of tabs is a feature. API clients go with the feature they serve; the shared HTTP helper goes in Shared model.
   - **A small app** (under about 10 files) can hold its files directly, with no components.
   - **One more level** only where a component would hold over about 25 files (and again below that, where a child would), scripted content aside. Split it by sub-feature. When one controller or service serves several of the new children, it and its DTOs form an "API" child. An entity and its DTO go to the child whose files use them most, not counting the API child or the aggregate root, which reference everything. A "State" child holds the aggregate root, its repository, and entities that several other children share. A node that has child nodes holds no files of its own, and its children are counted separately from the 3 to 9 at its own level.
   - **Development code inside a product app:** an extra `main` (a schema generator), acceptance drivers, capture and review modes, capacity probes, test clocks and operator hooks that only dev tools reach form one dev-tool component of that app, named for what it does and listed last.
   - **Every application file goes in exactly one node.** Use a folder glob when a folder maps cleanly onto a component, and list files when a responsibility cuts across folders.
6. **Add the links**, one per pair of files that talk across a process boundary, pointing from the side that starts it: caller to handler, client to server, writer to reader.
   - an actor to the app they use (evidence is optional);
   - **calls:** from the calling file to the handling file, for example the browser's API client to the backend controller. Evidence is every `call` line and its `route` line, plus the controller's class-level route line (such as `@RequestMapping("/kingdom")`) on each link into it, plus the production config line that sets the client's base URL when there is one (such as `VITE_API` in `.env.production`). When feature clients call a shared HTTP helper that does the real `fetch`, the link starts at the feature client and cites its lines; the helper is not a link end. The exception is a helper in another app or library node than the caller: then the link starts at the helper, where the network work happens, and the graph draws the caller → helper relation. Title it with what the calls do or their shared path ("kingdom actions, /kingdom/*"), not a list of every endpoint;
   - **stores:** from each file with a `store` line (the repository, the DbContext, the files that call the ORM session) to the database node. Evidence is that line plus the datasource line in the config;
   - **queues, sockets, pipes, external APIs, launched processes, file handoffs:** the same way, from the file to the node or file on the other side. A `socket` line can be a health probe or a free-port pick, and many `file` lines are reports, not handoffs: read the code to confirm the peer;
   - **navigation** (`window.open`, a link to another site) is a link only when a feature depends on that site, such as exporting to a companion service. Plain links to social pages or docs are not;
   - **timers inside the process** (`@Scheduled`, `setInterval`, BackgroundService) are not links. They belong to the component they drive, which you can say in its description. Only an outside scheduler (cron, a cloud scheduler) becomes a node with a link.
7. **Write the map**, with its `features`, to a scratch file and run `node scripts/zoom.mjs check <repo> <map.json>`, then `audit <repo> <map.json>` to review placement. It prints every node with its file count. Fix every error, and read every warning. Evidence in an application file should sit at one end of the link, or in a file that directly calls or is called by an end (the line that builds the URL a helper fetches); `check` warns otherwise. Config files can back any link. A warning that evidence "is not a line the graph recognised" quotes that line, so you can see whether it is the wrong line. When the real call is a line the graph does not mark (a wrapper function, a library it does not know), cite that line anyway and leave the warning. Never move evidence to a marked line that is not the call. Then run `node scripts/zoom.mjs publish <repo> <map.json>`. The viewer opens it at `?model=<name>`, and an open viewer adds its tab live.
8. **Report:**
   - what the product is, in your two sentences;
   - the features, each with the node that carries it;
   - the top level, and each process's components;
   - the number of links;
   - any feature the docs name that you could not find in the code;
   - anything you were unsure of.

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
    { "title": "Checkout", "nodes": ["web.checkout", "api.orders"] }
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

- **ids:** dot-separated segments; the part before the last dot is the parent node, which must exist.
- **kinds:** `actor`, `system`, `app`, `webapp`, `library`, `component`, `database`, `queue`, `external`. Files become `code` nodes on their own.
- **files:** repo paths or globs (`*` within a folder, `**` across folders). An exact path beats a glob, and a longer glob beats a shorter one.
- **features:** the headline features from step 3, in the product's words, core first, each with the nodes that carry it (any level, but within the top three). The viewer finds a node by the features it carries when someone searches with Ctrl K, and shows them on its details. `check` reports a feature that names an undeclared node, warns about one deeper than three levels, and warns about a top-level app that carries none.
- **link ends:** a node id, or the repo path of an application file.
- **evidence:** `path:line` or `path:start-end` in the repo, any file including config. Required unless one end is an actor. In application code it should be a line the graph marked. The viewer shows readers the cited lines (up to 8 per range) under the link, so cite the call itself, not the function around it.
- **titles and descriptions:** the user's language, not the folder's. A title names the responsibility ("Market", not "market/model"), and a description is one sentence on what it does. Put the stack in `technology`.

## Done means

- `check` reports no errors, no unplaced files, and no feature or library warnings.
- The top-left node after the actors is the core of the product, and development tooling sits in its own group, last.
- Every headline feature from step 3 is in `features` and has a node named for it. A reader who knows only the product's pitch can find each feature by name.
- From the top two levels alone, someone new can answer "where does X happen, and what does it call?" for the app's main features.
- Plumbing components are fewer than feature components in every process.
- No component is named after a technical folder ("utils", "model", "dto") unless it really is one cohesive thing.
