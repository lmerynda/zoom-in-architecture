# Zoomable architecture visualization: landscape and build-vs-build-on

Date: 2026-11-02. Sources: GitHub search (topics `c4-model`, `architecture-as-code`, `architecture-diagram`, `semantic-zoom`, `infinite-canvas`, `software-visualization`, `code-visualization`, `diagrams-as-code` plus keyword searches), web search, X posts surfaced through search, and hands-on runs of the live demos (headless Chrome, wheel-zooming into nodes).

## The goal, restated

One continuous map of a system. Scroll out and you see the whole landscape; scroll in with the mouse and each container opens in place to reveal the next level, down to components and, ideally, code. It should feel like a game's strategic zoom, not like clicking between separate diagrams.

## Verdict

**Build the renderer and interaction layer ourselves. Do not build the modeling language: use LikeC4's model as the data source.**

- Nobody has the UI we want. Every serious project is either a good model with a mediocre, discrete viewer (LikeC4, Structurizr, IcePanel), or a promising continuous-zoom viewer with a narrow or toy data model (Atlas, blockviz, Fractal). None of them renders like a game: they are DOM/SVG/React Flow or Canvas2D, which caps smoothness, element count, and visual effects.
- The UI is the product. Forking a React Flow app to get game-grade zoom means replacing its core, which is the same work as starting clean, plus inherited constraints.
- The model problem is already solved well. LikeC4 (MIT, 6k stars, active daily, v1.60) has a DSL, LSP, VS Code extension, MCP server, arbitrary nesting depth, and a programmatic API (`LikeC4.fromWorkspace(...)`, `model.element('a.b').incoming()`). Reusing it gives us a real input format and an existing user base on day one.

## What exists

### Continuous semantic zoom (closest to the vision)

| Project | What it does | Tech | Assessment |
|---|---|---|---|
| [nakuls08/atlas](https://github.com/nakuls08/atlas) (0★, Oct 2026, MIT) | Whole org architecture (departments → domains → services/APIs/topics) as one zoomable board from YAML. [Demo](https://nakuls08.github.io/atlas/) | TS, single HTML file | **Best interaction ideas found.** Same-size cards per level, positions never move as detail appears, containers open only when children's labels become readable, edges regroup to what is on screen, breadcrumb, minimap, trace mode, staleness marking. Tested: wheel-zooming into Payments & Risk opens it in place, keeps neighbours where they were, and the demo holds 408 components. Weak: edge spaghetti at top level, flat look, custom YAML schema. |
| [BlueBlazin/blockviz](https://github.com/BlueBlazin/blockviz) (75★, Oct 2026, MIT) | Codebase as nested block diagrams, zoom forever: repo → file → class → function dataflow → callee. [Demo](https://blueblazin.github.io/blockviz/) | Rust → WASM core in a worker, UI only draws | **Best "zoom into code" execution.** Tested: zooming into `model.py` reveals classes, then components and `forward` dataflow in place. Deep-linkable URLs, PR diff colouring, "used by". Code-derived only (Python/JS/Rust/Go), no curated architecture layer. |
| [kendreaditya/zoomables](https://github.com/kendreaditya/zoomables) (0★, Jun 2026, no license) | "Google Maps for architecture diagrams": recursive dagre layout, cursor-anchored eased zoom, alpha-cascade LOD, aggregated edges split as you zoom in. | Plain JS canvas | Good engineering notes on "never blank, never popping". No license, so ideas only. |
| [MrLesk/groma.md](https://github.com/MrLesk/groma.md) (367★, Jul 2026, MIT) | Live C4 map scanned from the repo, curated as Markdown, updates on save. Iso / 2D / Layers views. [Demo](https://mrlesk.github.io/groma.md/architecture/auto/) | TS | **The isometric view is the most game-like thing in the space.** Strong side-panel UX. Zoom is a plain camera, not semantic. |
| [Dicklesworthstone/franken_code_browser](https://github.com/Dicklesworthstone/franken_code_browser) (10★, MIT + rider) | Spatial source browser: repo atlas → readable source, Metal renderer, macOS only. Credits Rik Arends' Makepad demo. | Rust + Metal | Proves GPU text at scale. Mac-only, files not architecture. |
| Rik Arends' code visualizer (X, [coverage](https://www.tomshardware.com/tech-industry/developer-builds-viral-3d-source-code-visualizer-that-consumes-21gb-of-ram-flies-around-2-5-million-lines-of-code-at-over-120-frames-per-second)) | Flies through 2.5M lines of Chromium at 120 fps in 3D. Not released. | Rust, GPU | The performance bar. Shows what a game-engine approach buys. |

### Architecture-as-code with discrete levels (the C4 status quo)

| Project | Notes |
|---|---|
| [likec4/likec4](https://github.com/likec4/likec4) (6007★, MIT) | Best open model. Viewer is React Flow (`@xyflow/react`) + Mantine + d3. Tested: wheel zoom only scales; drilling down navigates to a different view. This is exactly the "C4 never nailed it" experience. **Use as the data layer.** |
| [structurizr/structurizr](https://github.com/structurizr/structurizr) (513★, Apache-2.0) | Simon Brown's reference tooling, Java. Static views. Its DSL is the other common input; consider an importer later. |
| IcePanel (commercial) | Click-to-zoom between C4 levels, flows, polished collaboration. Thoughtworks Radar featured it in 2024. Discrete, closed. |
| Ilograph (commercial) | Perspectives and contexts, animated transitions between levels, diagrams as YAML. Closest commercial take on "one model, many zooms", still not continuous. |
| D2 (25.8k★, MPL-2.0) | Boards/layers are separate pages. Good layout engine, not a viewer. |

### Code-graph and AI diagram generators (popular, different problem)

[archify](https://github.com/tt-a1i/archify) (92.7k★), [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (89.9k★, React Flow), [gitdiagram](https://github.com/ahmedkhaleel2004/gitdiagram) (18.7k★), [CodeBoarding](https://github.com/CodeBoarding/CodeBoarding) (2.7k★), [floorplan](https://github.com/haydenschmitty/floorplan) (2.2k★). Huge 2026 star counts show demand for "make my codebase understandable", but these generate single-level diagrams or force graphs. Useful later as model producers (an agent writes LikeC4 files), not as viewers.

### Software cities and research tools

[JSCity](https://github.com/aserg-ufmg/JSCity), [CodeCharta](https://github.com/MaibornWolff/codecharta), [SEE](https://github.com/uni-bremen-agst/SEE) (Unity, VR), ExplorViz (archived). Game-engine visuals but metric-driven (lines, churn), not architecture. Good reference for 3D legibility, poor for relationships.

### Rendering foundations (for building our own)

| Option | License | Fit |
|---|---|---|
| PixiJS v8 | MIT | 2D WebGL/WebGPU scene graph, bitmap/MSDF text, fast. Most direct path to a game feel in the browser. |
| deck.gl (OrthographicView) | MIT | Built for millions of objects with LOD and smooth camera; geo heritage. Strong if scale is the priority. |
| three.js | MIT | Needed only if we commit to real 3D / iso with depth. |
| Rust + wgpu → WASM | MIT/Apache | Best ceiling (blockviz and Arends prove it), slowest to iterate. |
| elkjs | EPL-2.0 | Hierarchical layout with nested ports; the standard answer for nested architecture graphs. Run in a worker. |
| xyflow / tldraw | MIT / custom (tldraw needs a license for production) | DOM-based; good editors, wrong ceiling for this. |

## What X and the web say

- Simon Brown himself pitched C4 as "Google Maps for your code" in 2018, but every C4 tool ships it as separate diagrams. The gap between that pitch and the tools is the opportunity.
- Semantic zoom has a small, enthusiastic following (Prathyush's 2025 thread on Ecola and the Dion editor; Microsoft's SemanticZoom control), mostly for code editors, not architecture.
- 2026 X chatter is dominated by AI-generated diagram skills (archify, diagram-design). Nobody there is shipping a continuous-zoom architecture viewer.
- Limit: X needs a login, so I only saw posts that search engines index. Coverage of X is thin; GitHub coverage is good.

## Design principles to carry over

From what worked in the demos, plus game UI:

1. **Stable world.** Positions never shift when detail appears (Atlas). A map you can learn is the whole point.
2. **Open on legibility, not on zoom level.** A container reveals children when their labels would be readable at the current scale (Atlas, Fractal). No fixed "level 1/2/3" thresholds.
3. **Never blank, never pop.** Crossfade parent summary into children; keep the parent's frame and title pinned while inside it (Fractal, blockviz).
4. **Edges follow the zoom.** Aggregate edges between visible ancestors, split them into specific labeled relations as you go deeper, show counts on bundles (Atlas, Fractal).
5. **Strategic-zoom icons.** As in RTS strategic zoom, zoomed-out elements swap to clean icons and labels sized in screen space, so the overview stays readable at any scale.
6. **Minimap, breadcrumbs, search-to-fly, deep-link URLs, back/forward history** (Atlas, blockviz).
7. **Overlays as game layers.** Ownership, health, PR diff, staleness rendered as toggleable map layers (blockviz diff colouring, Atlas staleness, fog-of-war for stale or unreviewed areas).
8. **Layout off the UI thread.** Parse and lay out in a worker, the main thread only draws (blockviz).

## Recommended first step

A throwaway spike, one to two days, to settle the two real unknowns before any architecture decision:

1. Load the LikeC4 template workspace through `LikeC4.fromWorkspace`, lay out every nesting level with elkjs in a worker.
2. Render it in PixiJS v8 with continuous zoom, legibility-driven opening, crossfades, and edge aggregation.
3. Measure: frame time at 1k and 10k elements, text crispness across a 1000× zoom range, and whether ELK's nested layout keeps positions stable enough.

If PixiJS text or frame time disappoints, the fallback is the Rust/WASM path.
