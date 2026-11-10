# Force-directed layout, tried on a real map

Complexity tools often draw code as a node-link graph laid out by forces: edges pull, nodes repel, so the most connected nodes settle in the middle and tight clusters group themselves. The question was whether that shows a codebase better than nested cards.

The Knights of Darkness model (one game server, one browser client, development tools) was laid out with Fruchterman–Reingold at three scales, node size by connection count. The script is a scratch experiment, not part of the viewer.

## What each scale showed

- **257 files, 978 edges: a hairball.** Inside the server nothing can be followed; labels pile on each other. The hubs it puts in the middle are data and configuration, not architecture: KingdomEntity (63 connections), GameConfig (53), then the enums ResourceName (37), UnitName (29) and BuildingName (24). KingdomService (44) is the only real centre of behaviour among them. What it does show well is the coarse shape: the client is an island joined to the server only through the generated `endpoints` client, and the development tools hang off to one side.
- **22 map nodes (apps and components), edges rolled up and weighted: the clearest picture of the three.** Two clusters, server and client, joined by one bridge (the API client). Kingdom (187) and Game rules and shared model (183) sit at the centre of the server, with War and Market next; Simulation edge, Accounts and Eras sit at the rim. That is a true and useful statement about the architecture, and the nested-card landscape does not make it spatially: it orders cards as the map lists them.
- **10 server components: readable, but no news.** The same centre (Kingdom, shared model, War, Market), and the same rim. The card view with its edge counts already says this.

## Verdict

Force layout answers a different question from nested cards. It shows where the coupling is and what bridges what; nested cards show what the system is made of and let you walk down to code. At the file level the force graph is worse: a hairball whose hubs are data types. At the component level (roughly 10–40 nodes) it is better than our grid at one thing: placing the centre of gravity in the centre and the clusters apart.

Costs that matter for this tool:
- **Instability.** A force layout moves when the code changes; live updates in the viewer rely on cards keeping their places so a reader keeps a mental map.
- **Reading order.** The map's order (people, core app, other apps, stores, tooling) is a deliberate reading order; forces discard it.
- **Hubs mislead.** Most-connected is not most important: shared models, configuration and enums win degree contests.

## Options, cheapest first

1. **Keep the cards; use the graph metrics.** The Coupling lens already colours cards by relations crossing their boundary. A betweenness lens would add the bridges (the API client here) without moving anything.
2. **A Coupling view beside Architecture and Requests.** One level at a time (apps and components), force-directed with weighted edges, node size by connections, flying into a node opens its level in the card view. It keeps the card view as is and makes the coupling picture available where it reads well.
3. **Arrange siblings by connection inside the cards.** ELK (already used for layout) has a stress algorithm that could replace the grid for component levels. It changes every map's layout and its live stability, so it is the most invasive and should come last, if at all.

## What was built

Option 2, kept inside the zoom: a Connections view (first called Coupling, renamed so it is not confused with the Coupling lens) beside Architecture and Requests that uses the same cards, nesting and code, and changes only how each level is arranged. Instead of free force placement it keeps the card grid (so edges still route through gutters and nothing overlaps) and fills it centre-out: the most connected child in the middle on a 2 × 2 card, then each next by importance in the free cell nearest the siblings it is coupled with. Cards carry their rank, and `.` / `,` walk a level from the most connected to the least. On Knights of Darkness: Game server is #1 at the landscape (37 relations), Kingdom #1 inside it (187) with the shared model, War and Market beside it, Simulation edge at the corner; inside Kingdom, KingdomEntity (63) is the centre of its storage component.

Two review rounds then tuned it (7, then 8 out of 10). #1 sits exactly at the centre on every level (the grid takes the parity that allows it), cards fill rings outward by true distance so rank and radius agree (worst inversion on the measured levels: 0.056 of a level's diagonal), and ranking is breadth before volume: siblings reached, then relations. On one mapped game that moved the centre of the landscape from a shared-contracts library (the most relations, but reaching under half its siblings) to the game server that reaches the most of them, which is the answer to the "hubs mislead" concern above. The view was renamed Connections so it is not confused with the Coupling lens.
