# Viewer review, 2026-11-09

Two independent read-only reviews of main at `60f0005`, by Fable 5.1 and Fable 5.2, each driving the running viewer over the knights-of-darkness, spring-petclinic, zoom-in-architecture and acme models. Neither saw the other's report. Findings both made are listed first; a finding one review made alone was checked against the code before it was listed.

## Both found

- **The flowing wires encode nothing new.** `src/fx/particles.ts:46-53`: a fixed 85 px/s (150 when highlighted), a count driven mostly by the line's length on screen (`len / 110`, times a log of the folded reference count), and the direction from importer to imported. Arrowheads, three line widths and the "N relations" labels already say direction and count. The motion reads as runtime traffic, which it is not, and on shared trunks the particles of many edges pile up into noise. Both recommend removing the ambient animation and keeping motion only on a hovered or selected card's edges, or along a route.
- **The ENTERING banner collides with card titles.** At the landscape it announces a component two levels down over "Game server", because the screen centre lands on it. The breadcrumb and the altimeter already say where you are.
- **HUD over content.** Altimeter labels, off-screen chips and the stats box sit on card text and source code once a file fills the screen.
- **The top bar overflows.** Tabs truncate; turning on a lens widens the lens bar, which wraps "Travel to…" and squeezes the tabs further.
- **Middle levels and file cards read poorly.** Tiles at levels 2 and 3 have no labels until they are about 70 px. File cards show a name and the word "code". Large files draw no code preview, because a line under `MIN_PX = 1.2` px is skipped (`src/code.ts:16`), so a 543-line service looks emptier than a 76-line DTO. This also leaves the handler step of a request without code.
- **Request paths are not what the method does.** Below the handler, steps follow every file the previous step imports (`routes.mjs:291-300`), so `GET /kingdom` lists market and attack repositories. The numbers are discovery order, not call order: DTOs come before the service, and PetClinic's two alternative views appear as steps 4 and 5. A map link that targets the whole app lands on every endpoint (`requests.mjs:189`), so Development tools calls all 67.
- **No provenance in the viewer.** Uploads record the commit, but nothing on screen shows the commit, age or uncommitted changes, so a stale map looks current.
- **`/upload` has no token and no size cap,** and any name overwrites that import (`vite.config.ts:55-71`).
- **The service exists only inside `vite dev`;** a static build has no upload, source or live updates.
- Plurals: "1 relations", "1 commits".

## Fable 5.2 alone

- **"Never invents a relation" overclaims.** Import relations do come only from the graph (`map.mjs:159`), but agent links are file-to-file relations too, and `check` only proves the cited line exists, not that it supports the link. "Every link is checkable" is the honest wording. Graph relations carry names but no file:line, so a reader cannot check those at all.
- **"Resolves every reference" overclaims:** `graph.mjs` and `routes.mjs` are regex scanners, and misses are silent.
- **Config lines travel as evidence.** The datasource block cited for the database link is shown in the panel with its default password; a real secret on a cited line would be uploaded and displayed.
- **`--watch` drifts silently:** loose mode places new files by neighbour vote and keeps links with broken evidence drawn (`map.mjs:108-120`, `:181`).
- **The route panel shows as an empty pill** bottom left on every screen (`.routepanel` is not hidden when empty).
- **A file-level lattice:** inside a busy component, 96 edges share gutters and answer nothing until one card is selected. Draw only the focused card's edges there.
- **Titles shrink to fit** their card (`render.ts:520`), so sibling titles differ about 3× in size and a long one disappears.
- **Decoration** (starfield, nebula, glow, pulses, reticle, sound) lowers the contrast of 1.3 px edges and contradicts the project's own rule: the control vocabulary of games, not their graphics.
- Lens hot end is pale yellow under white titles; per-level normalisation makes colours incomparable across levels. Evidence snippets clip at the panel's width. The tool's own map uses under half the screen at its landscape.

## Fable 5.1 alone

- Feature chips did not show in the Kingdom panel.
- Relation titles repeat the target ("KingdomTurnReport / KingdomTurnReport").
- Actors take a full cell, as large as the apps.

## Where they differ

- **Decoration:** 5.1 calls the starfield harmless; 5.2 would remove it with the particles. The project rule (game controls, not game graphics) sides with 5.2.
- **Where motion stays:** 5.1 keeps a brief pass on hovered or selected edges; 5.2 keeps it on the selection and on a route, and later a single pulse walking a request's steps once real call order exists. They agree that motion should only appear on what the reader is focused on.

## Order of work

1. **Quiet the canvas:** remove the ambient particles, the ENTERING banner and the empty route pill; motion only on focus.
2. **Fix the chrome:** top-bar overflow, HUD over content, plurals.
3. **Make files legible:** a coarse code preview for big files, one title size per level, labels at the middle levels, only the focused card's edges at file level.
4. **Make request paths true:** the steps a method really reaches (or marked "may reach"), ordered by call depth, the handler's code shown, and app-level callers not fanned onto every endpoint.
5. **Earn trust:** provenance on screen, honest wording for "never invents" and "resolves every reference", secrets kept out of evidence, a token and size cap on `/upload`.
6. **Decoration:** starfield, nebula and sound are a taste call for the owner.

## Scored rounds

After the six steps above, both reviewers scored main out of 10 (truthfulness, legibility, visual quality, interaction, overall) in rounds, each re-checking its own previous list and looking again from scratch. Fixes went in between rounds, each with a test where one could prove it.

| Round | Fable 5.1 | Fable 5.2 | What the round's fixes were mostly about |
|---|---|---|---|
| 1 | 6 | 7 | (the six steps above) |
| 2 | 7 | 8 | unbounded zoom, request steps following same-named methods, unopened containers drawn as blank tiles, edge counts hidden on busy screens or unattributable on shared trunks |
| 3 | 8 | 7.5 | titles cut on open cards, hover on a container's background lighting every edge, lens values over text; 5.2 dropped because the new panel-clearing glide threw the selected card off screen (a view-rectangle bug) |
| 4 | 8.5 | 8.5 | the glide fixed and tested on screen, chips under the minimap (one pass of overlay checks could lift a chip from the help line into the minimap), a double-click window before the glide, resize keeping the view |
| 5 | 9 | 8.8 | names on the first screen, contents listed on closed cards, the details panel folding over code, quieter busy edges; 5.2 also found the double-click test passed without a double-click (puppeteer's `click({ clickCount: 2 })` fires no `dblclick`) |
| 6 | 9 | 9 | names at full strength as boxes fade in, code previews on file cards at fit size, no title over code opened from its top |

What both still name, none of it holding the score under 9:
- Scanner misses are silent on the map.
- Ten of the eleven imports predate the request-path fixes and show "age unknown" until their projects upload again.
- At mid zoom into a file the code can sit under an empty band, and a drag inside a large card can leave a blank screen with only the minimap as a cue.
- Four long component names are cut at the landscape.
- `publish --watch` and `check` refusals were not exercised by either reviewer (the reviews were read-only).
