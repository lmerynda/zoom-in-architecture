# Zoom spike

Throwaway prototype: LikeC4 model → nested ELK layout in workers → PixiJS v8 renderer with continuous semantic zoom. Findings are in [../docs/research/2026-11-02-spike-findings.md](../docs/research/2026-11-02-spike-findings.md).

```bash
npm install
npm run dev        # extracts the models to public/models/, serves http://localhost:5180
npm test           # unit tests: tree, aggregation, placement, camera, clipping, live diff, importer
```

URL parameters: `?model=<name>` (default `acme`), and `?model=synthetic&n=10000` for a generated landscape of that size. The tabs list every model there is.

## Import your own codebase

Click **+ Import** in the top bar (or `Ctrl+K`, "Import project…") and give the path of a local repository. Or from the command line:

```bash
node scripts/import-code.mjs ~/src/shop                       # writes imports/shop/*.c4
node scripts/import-code.mjs ~/src/shop --config shop.json    # with titles, actors and seams
npm run extract                                               # the dev server does this on its own
```

The importer reads the code; nothing is written into the repository it imports. Imports live in `imports/`, which is not committed.
- **Projects** come from manifests: `.csproj`, `Cargo.toml` packages, `package.json`, and Unity projects (`ProjectSettings/` next to `Assets/`). Files are what git lists, so `.gitignore` applies.
- **Levels:** system → area (top folder) → project → folder → name cluster (for folders over 20 files) → file.
- **Descriptions:** a C# `/// <summary>`, Rust `//!` or `///` comments, or a JS/TS leading comment.
- **Relations** are references between files:
  - C#: type names declared in the same project or one it references;
  - Rust: module paths, and paths into the repo's other crates;
  - JS/TS: relative imports, and imports of the repo's other packages.
- **Lenses:** each file gets its line count and its commits from the last 90 days, for the size and churn lenses.

What code references cannot show (who uses the system, the database, network calls between processes) goes in an optional config:

```json
{
  "title": "Shop",
  "areas": { "src": { "title": "Backend" } },
  "projects": { "src/Api": { "title": "API", "area": "src", "description": "Public HTTP API." } },
  "elements": [
    { "id": "customer", "kind": "actor", "title": "Customer" },
    { "id": "db", "kind": "database", "title": "PostgreSQL" }
  ],
  "links": [
    { "from": "customer", "to": "web", "title": "shops" },
    { "from": "src/Api/Data/ShopDb.cs", "to": "db", "title": "EF Core" }
  ]
}
```

Projects are keyed by their folder in the repository. Link ends are element ids, or the repository path of a file, folder or project. The importer reports links it cannot place. Element kinds: `actor` (outside the system), `database`, `queue`, `external`, `system`.

## Live mode

With `npm run dev` running, saving a `.c4` file under `model/` or `imports/` re-extracts that workspace and the open map updates in place:
- unchanged containers keep their exact layout;
- survivors glide to their new places, and new cards grow out of their parent;
- changed cards glow (green added, amber changed), and a toast lists what was removed;
- the camera stays on the selection, or on what is under the screen centre.

An imported codebase is followed too. Saving a source file, a manifest or its config re-runs its import, and the map updates the same way.

Two scripts check this end to end:
- `node scripts/live-test.mjs` edits `model/acme/model.c4` while the map is open, checks the update, then restores the file.
- `node scripts/import-test.mjs` imports a copy of `test/fixtures/polyglot` through the Import button, edits its source, checks the map follows, then removes the copy.

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

Also: hovering and holding still locks a tooltip whose names open their own tooltips; a route's stops are clickable in its panel; pinned cards point the way from the screen edge; the minimap clicks and drags; arrow keys and `+` / `-` move the camera; the lens bar and sound button are in the top bar.

## Measuring

With the dev server running:

```bash
node scripts/probe.mjs "model=synthetic&n=10000"          # screenshots and report into shots/
DPR=2 node scripts/probe.mjs "model=synthetic&n=10000"    # same at device pixel ratio 2
node scripts/layout-bench.mjs 1000                         # ELK option sets: card fill and time
DPR=2 node scripts/tour.mjs                                # screenshot walkthrough into shots/tour/
node scripts/ux-tour.mjs                                   # drives every control with real input into shots/ux/
node scripts/live-test.mjs                                 # edits a model while the map is open, checks the live update
node scripts/import-test.mjs                               # imports a repo from the app, edits it, checks the map follows
node scripts/record.mjs acme-controls code-dive            # frame-exact MP4s into shots/video/ (code-* scenes import this repo)
```

`probe.mjs` drives Chrome (set `CHROME` to another binary), wheel-zooms from the overview into the deepest element, flies back out, pans the overview, and writes frame-time percentiles plus `window.__spike.gpu` so you can see which GPU rendered.

## Layout of the code

- `scripts/extract-likec4.mjs` — LikeC4 workspaces (`model/`, `imports/`) → `{ elements, relations }` JSON, plus `index.json` listing them.
- `src/model.ts` — hierarchy as flat arrays under a virtual root; relation roll-up.
- `src/layout.ts`, `layout.worker.ts`, `layoutPool.ts` — one ELK rectpacking layout per container, batched per worker, sibling edges routed there; cards scaled into their parent's content area.
- `src/route.ts` — orthogonal channel router through the gutters, with trunk sharing.
- `src/edges.ts` — composes routes across nesting levels so no edge crosses a card.
- `src/camera.ts` — float64 camera, cursor-anchored eased zoom, inertia, fly-to about a fixed point.
- `src/render.ts` — per-frame traversal in screen space: culling, detail tiers, labels, edges, focus highlighting, off-screen chips.
- `src/details.ts` — the selection panel.
- `src/live.ts`, `vite.config.ts` — live mode: model diff, layout reuse and stable child order; the dev-server watcher.
- `src/controls/` — game-style controls: palette, history, target cycling, wheel, routes, pins, tooltips.
- `model/acme/` — the realistic sample model.
- `scripts/import-code.mjs` — the codebase importer; `src/models.ts` — model tabs and the Import box; `scripts/self-import.mjs` — this repo as a model, for tours.
- `src/synthetic.ts` — deterministic five-level landscapes for scale tests.
