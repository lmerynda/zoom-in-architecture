---
name: map-repo
description: Map a codebase's application architecture into the zoom-in-architecture viewer. Use when asked to map, import, visualize or re-map a repository ("/map-repo <path>"), or to refresh a published map after the code changed.
---

# Map a repository

You turn a repository into an architecture map: the apps that run, the components inside them, and the files inside those, plus how they talk. The tool gives you the facts. You give them structure and meaning.

- **Facts, from code:** `zoom.mjs graph` lists the application files and every reference between them. It drops tests, build configs and dead code: whatever no entry point reaches. Dev tools with an entry point of their own (a CLI, an operator app, editor scripts) stay. They are part of the system: a separate dev-tool project is its own app, apart from the product, and an extra `main` inside a product project is a component of that app (step 4).
- **Your job:** group files into components by responsibility, name and describe them, and add the links code references cannot show (HTTP calls, the database, schedulers), each with `file:line` evidence.
- **Never invent a relation between files.** The tool draws those from the graph. A component's relations are rolled up from its files.

All commands run from `spike/` in this repository. `<repo>` is the absolute path of the repository to map.

## Steps

1. **Read the graph:** `node scripts/zoom.mjs graph <repo>`. Read all of it. It lists:
   - the projects (hints for the deployables) and the entry points, including `main` methods;
   - the config and deploy files;
   - every file with what it uses and what uses it. Named imports through a barrel (`index.ts` re-exports) point at the file that defines the name. Type-only imports are listed apart as `types →`: the map does not draw them, and they should not decide where a file goes;
   - under each file, the lines where it talks to another process: `route`, `call`, `store`, `schedule`, `socket`, `message`, `process` and `file`, each with its line number. These are your link evidence.

   `--json` gives the same graph as data, with complete "used by" lists (the text caps long ones).

   Over about 300 files, start with `graph <repo> --folders`: each folder with its size, its hints and the folders it references. Then read the files part by part with `graph <repo> --under <folder>`.
2. **Start from the previous map** if `imports/<name>/map.json` exists (`<name>` is the repo folder in kebab case, such as `knights-of-darkness`). Keep its ids, so the viewer morphs instead of rebuilding, and change only what the code changed.
3. **Read the code that defines the structure.** Not every file:
   - entry points, routers, controllers and API clients;
   - the config and deploy files the graph lists, for datasources, base URLs and other services;
   - the target repo's README and docs, for its own vocabulary.
4. **Design the levels:**
   - **Top level:** actors (who uses it), one node per process that runs (web app, backend service, worker, CLI), and stores and external services (database, queue, third-party API).
     - A browser UI is its own `webapp` node, even when a backend serves its files; link it to what it calls.
     - **Shared code:** a library project that two or more apps use is a top-level `library` node. So is a published package (a workspace package that is not `"private"`): other people consume it, so it is a deliverable even when one app in the repo uses it. A private library that a single app uses folds into that app's components.
     - **A library's barrel** (the `index.ts` that re-exports its modules) is its "Public API" component.
     - **Related apps** such as examples, experiments, prototypes or a set of dev tools can be grouped under a `system` node, so they read apart from the product.
   - **Inside each process:** 3 to 9 components by responsibility, such as Market, Alliances, Turn processing or Sign-in. Prefer the domain over the technical layer: Market holds its controller, service, entities and DTOs. Dev-tool components (below) don't count toward the 9.
   - **Code that belongs to no feature** always goes to the same places, so different runs agree:
     - **Startup:** the entry point, seeders, the health check, and config classes that only build beans or wire services. A config class that sets a feature's behaviour (security rules, CORS for sign-in) stays with that feature;
     - **Shared model:** types that three or more features use and no feature owns (ids, shared enums and names, base DTOs);
     - a utility goes with its main user, or in Shared model when most features use it. Count users by the components directly inside the process, not by deeper children;
     - the domain's own rules and configuration are a feature like any other ("Game rules"), not a home for leftovers;
     - **a file with no feature of its own** that several features use goes with the feature whose files reference it most. On a tie, it goes in Shared model, or in Startup if it is configuration. A feature's own interfaces and types stay with that feature, however much another feature uses them.
     - `node scripts/zoom.mjs why <repo> <map.json> <file>` shows which node holds a file, and its users and uses grouped by node. Use it instead of counting by hand.
   - **In a front end,** the app shell (entry, router, layout, sign-in pages) is one component, and each screen or group of tabs is a feature. API clients go with the feature they serve; the shared HTTP helper goes in Shared model.
   - **A small app** (under about 10 files) can hold its files directly, with no components.
   - **One more level** only where a component would hold over about 25 files (and again below that, where a child would). Split it by sub-feature. When one controller or service serves several of the new children, it and its DTOs form an "API" child. An entity and its DTO go to the child whose files use them most, not counting the API child or the aggregate root, which reference everything. A "State" child holds the aggregate root, its repository, and entities that several other children share. A node that has child nodes holds no files of its own, and its children are counted separately from the 3 to 9 at its own level.
   - **Several entry points in one project:** the extra `main` is usually a dev tool, such as a schema generator. Give it its own small component named for what it does, apart from the service's features.
   - **Every application file goes in exactly one node.** Use a folder glob when a folder maps cleanly onto a component, and list files when a responsibility cuts across folders.
5. **Add the links**, one per pair of files that talk across a process boundary, pointing from the side that starts it: caller to handler, client to server, writer to reader.
   - an actor to the app they use (needs no evidence);
   - **calls:** from the calling file to the handling file, for example the browser's API client to the backend controller. Evidence is every `call` line and its `route` line, plus the controller's class-level route line (such as `@RequestMapping("/kingdom")`) on each link into it, plus the production config line that sets the client's base URL when there is one (such as `VITE_API` in `.env.production`). When feature clients call a shared HTTP helper that does the real `fetch`, the link starts at the feature client and cites its lines; the helper is not a link end. The exception is a helper in another app or library node than the caller: then the link starts at the helper, where the network work happens, and the graph draws the caller → helper relation. Title it with what the calls do or their shared path ("kingdom actions, /kingdom/*"), not a list of every endpoint;
   - **stores:** from each file with a `store` line (the repository, the DbContext) to the database node. Evidence is that line plus the datasource line in the config;
   - **queues, sockets, pipes, external APIs, launched processes, file handoffs:** the same way, from the file to the node or file on the other side. A `socket` line can be a health probe or a free-port pick, and many `file` lines are reports, not handoffs: read the code to confirm the peer;
   - **timers inside the process** (`@Scheduled`, `setInterval`, BackgroundService) are not links. They belong to the component they drive, which you can say in its description. Only an outside scheduler (cron, a cloud scheduler) becomes a node with a link.
6. **Write the map** to a scratch file and run `node scripts/zoom.mjs check <repo> <map.json>`. It prints every node with its file count. Fix every error, and read every warning. Evidence in an application file should sit at one end of the link; `check` warns when it doesn't. Config files can back any link. A warning that evidence "is not a line the graph recognised" quotes that line, so you can see whether it is the wrong line. When the real call is a line the graph does not mark (a wrapper function, a library it does not know), cite that line anyway and leave the warning. Never move evidence to a marked line that is not the call. Then run `node scripts/zoom.mjs publish <repo> <map.json>`. The viewer opens it at `?model=<name>`, and an open viewer adds its tab live.
7. **Report:** the top level and each process's components, the number of links, and anything you were unsure of.

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
    { "id": "db", "kind": "database", "title": "PostgreSQL" }
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
- **link ends:** a node id, or the repo path of an application file.
- **evidence:** `path:line` or `path:start-end` in the repo, any file including config. Required unless one end is an actor. In application code it should be a line the graph marked.
- **titles and descriptions:** the user's language, not the folder's. A title names the responsibility ("Market", not "market/model"), and a description is one sentence on what it does. Put the stack in `technology`.

## Done means

- `check` reports no errors and no unplaced files.
- From the top two levels alone, someone new can answer "where does X happen, and what does it call?" for the app's main features.
- No component is named after a technical folder ("utils", "model", "dto") unless it really is one cohesive thing.
