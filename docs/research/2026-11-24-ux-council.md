# UX/UI council on the viewer, 2026-11-24

Three independent audits of main at `c5949c3`, by Opus 5.5 (chair), Fable 5.2 and Codex (gpt-6.2-astra, xhigh). Each drove the running viewer with real mouse and keyboard input: knights-of-darkness in all three views (the map traced with its own tests), with visits to petclinic, rw-golang-gin, excalidraw, galaxy-wars and this repo's map. Sizes: 1600×1000, 1920×1080 at DPR 2, 200% browser zoom (800×500 CSS px), 390×844 touch and 320×568. None saw the others' reports. This builds on the [viewer review](2026-11-21-viewer-review.md) (all shipped) and the [focus review](2026-11-22-focus-review.md) (open backlog: endpoint inventory, transport labels, surface on the default view). Neither is repeated here. Reports, scripts and about 200 screenshots were working files and are not committed.

Not checked by any seat: speech in a real screen reader, physical touch and pinch.

## Verdict

All three: the desktop viewer is sound where the first review worked. DOM text passes AA nearly everywhere, Help is a real dialog, the reader opens at the method line and returns cleanly, Back works, and there are no console errors. Three things are not there yet:
- **The trace marks give wrong answers**, on the newest feature, which a reviewer would use to approve agent work. Every call into the server was dashed "not seen in tests" although 63 of 67 endpoints were hit; a store arrow says "writes" a table the SQL only read; a repository is credited with every request of its endpoint, 401s included.
- **Below about 700 px the viewer cannot be used.** The top bar pushes Requests, Colour by and Help off the screen, the welcome's Got it sits under the bottom sheet, Help loses two of its three columns at 320 px and at 200% zoom, and the reader's header collapses.
- **Keyboard and screen-reader users lose their place.** Focus rings in the outline and menus measure about 1.2:1, focus falls to `<body>` after a selection, search exposes no options, and an arrow's evidence opens only by mouse.

On the focus review: all three still rank the endpoint inventory as the top *product* priority, after the items below. Codex's point decides the order: publishing trace counts and table effects in more places before they are right spreads the wrong answers.

## Ranked backlog

Seats: C chair, F Fable, A Astra. P0 blocks a task or fails WCAG 2.1 AA; P1 costs real time or looks broken; P2 polish. Effort S under a day, M a few days, L a week or more.

### A. Trace marks that are true (P0)

1. **Calls into a traced app from outside it are drawn "not seen in tests"** (C F A, S). The tracer sees only JVMs, and `observed.mjs:47` marks a link seen only when its source file ran, so a browser's, a test client's or a person's call can never be seen. Judge only links that start in a part where code ran; draw the rest plain and say "outside the trace". Name the dash in the legend only when the map has one. **PR 1.**
2. **A store arrow says "writes" for tables only read** (A, S). `observed.mjs:84` picks one verb for all tables if any table was written. Label per table from its own operations: "updates kingdoms · deletes offers · reads users".
3. **Counts without units, and credit without attribution** (C F A, M). A repository step copies its endpoint's 6,675 requests (`observed.mjs:76`, `:81`); the same server → database pair reads 877,679 in Architecture (method spans) and 272,819 in Requests (requests). Keep requests, spans and statements apart and say which; until a hop has its own count, say "ran during this endpoint's requests" without a multiplier. Separators shipped in PR 1.
4. **A solid aggregate hides its one untested relation** (A, S). Game server → Game database ×15 is solid though one of the 15 was never seen. Put "14/15 seen" on it and list the exception first.
5. **Untested endpoints look like every other** (F, S). Only 9 px subtitle text tells them apart; finding the four of 67 means opening ten groups. Dashed border, an "untested" tag in the outline, "7 endpoints · 2 untested" on groups, and "63 of 67" as a button listing the four.
6. **The endpoint's tested tables contradict its Uses list without saying so** (F, M). Buy: tests saw five tables, the path reaches one. List Writes and Reads, and one line on the difference.
7. **The run behind the marks needs a hover** (A, S). Command, time, exit status and coverage as a keyboard-reachable "Test run" disclosure.

### B. Narrow screens and zoom (P0, WCAG 1.4.10)

8. **The top bar clips its controls below ~660 px** (C F A, S). Wrap it: map, Search and Help; then the place, once inside something; then the view and the lens. **PR 2.**
9. **The arrow legend takes a fifth of a phone screen** (C, S): one "Arrows" button that opens it. **PR 2.**
10. **The welcome's Got it is under the bottom sheet** (F A, S); on desktop it covers the legend (C F).
11. **Help loses columns at 320 px and at 200% zoom** (F A, S): `width: min(100%, 1040px)`, one column under 600 px, top-aligned and scrollable.
12. **The phone reader hides the file name and stacks Copy over the title** (F A, S); the panel shows through its 97% background (F).
13. **Phone search gives the path zero width** (A, S): kind and title on one line, the path on a second.
14. **The bottom sheet takes half the map with no way to shrink it** (F, M).

### C. Keyboard and assistive technology (P0)

15. **Focus rings at about 1.2:1** (C F A, S). Outline rows, lens and context menus use a 12-16% amber wash; the reader's scroller has none. One rule: `:focus-visible { outline: 2px solid #fbbf24 }`.
16. **Search exposes no options** (F A, S). Combobox, listbox and options with `aria-activedescendant`; restore focus on cancel.
17. **Focus falls to `<body>` after a selection, and nothing announces it** (F, S). Focus the panel's heading when focus was in the panel; announce "Selected Game server: uses 1, used by 2".
18. **An arrow's evidence opens only by mouse** (A, M). An "Inspect 15 relations" button on each Uses / Used by row, reusing the arrow panel.
19. **State shown only by colour** (F A, S): `aria-current` on the active view and map, `aria-expanded` on the model and Colour by buttons, "Show type-only imports" as the legend button's name.
20. **The selected search row's path is 4.36:1** (F A, S): the token check misses the amber highlight.

### D. Arrows you can attribute

21. **Clicking a shared trunk opens a different arrow than the tooltip names** (F A, S). The tooltip sums every line under the pointer; the click takes `lines[0]` (`install.ts:242`). List every pair under the pointer, heaviest first.
22. **The six landscape arrows fuse into one figure** (F, M). On knights it reads "Player → Game server". With few edges, share trunks only between edges with a common end.
23. **A selection recolours arrows and erases their kind** (C, M). Selected, only the dash is left, and two legend kinds are dashed. Keep kind in the stroke (type-only dotted), colour for direction only.
24. **A selected request's own step arrows are the faintest thing on screen** (F A, S): 1.15-2.3:1, because every edge not the selection's is at 0.1 (`render.ts:858`).
25. **Chips under the legend; a card title past its border** (C F A, S). Add both legends to the rectangles chips avoid; clip titles after the sticky offset.
26. **Closed cards inside an open container are nearly invisible** (F C, S): border 1.42:1; and at overview zoom they are empty boxes with a tiny title.

### E. Places and navigation

27. **Search shows War but keeps Development tools selected and in the address** (A, S). Reload reopens the old card.
28. **"← back to POST /market/{id}/buy" lands on the handler** (A, S): it should go to the endpoint.
29. **Twelve identical search hits in Requests** (A, S): one file in 31 endpoints shows 11 copies of "3 · KingdomRepository". Group by file, name the endpoint.
30. **Picking a feature selects a card two levels down and rings its parent's title** (F, S-M).
31. **The Size legend's numbers are global on a per-level scale** (A, S).

### F. Visual system (P2)

32. **Type scale** (F A): base 12 px with 9, 10 and 11 px tiers. Base 13; 11 / 13 / 15 / 19; nothing under 11; panel column 360-420 px on wide screens, where the relation names are cut at 330.
33. **Accents with no fixed meaning** (F): amber is kind badge, primary button, outgoing, citation, focus, feature, stale and "not seen"; two greens. Amber for outgoing only; one green.
34. Small: the details column ends 174 px early when the minimap is hidden (F); actor cards turn into pills at narrow widths (C); the map fits into the middle third on a phone (C); Requests and Connections title the map differently (F); rail ticks are 10×4 px and Tab visits them out of order (A); the welcome lists 10 of 19 features with no "9 more" (F); Vite's dependency scan crawls uploaded sources at start (C).

## Build order

The council builds the top items now, one PR each, with both other seats reviewing before it opens:
1. Trace marks judge only what the trace could see (A1).
2. Phone and zoom: bar, legend, welcome, Help, reader, search rows (B8-B13).
3. Keyboard and assistive technology (C15-C17, C19-C20).
4. Arrows you can attribute by click and by keyboard (D21, C18).
5. Places: search and the reader's back keep the subject (E27, E28).

Then A2-A7 (trace counts and effects; data changes, so maps change only when a project publishes again), and then the focus review's endpoint inventory.

## Status, 2026-11-24

Five branches, each stacked on the one before (they share the arrow legend, the panel's focus handling and the test scripts), so they merge in this order. Each passed `npm test`, `npx tsc --noEmit` and the browser checks (`answers-test`, `controls-test`, `place-test`; `publish-test` for the first), and each was reviewed by Fable and Codex before being called done; every blocking point they raised is fixed on the branch.

1. `council/trace-marks-honest` (A1, part of A3). A call is judged against the trace only when a file in a part where code ran makes it; calls from a browser, a test client or a person are drawn plain and say "outside the trace". Requests callers are calls at runtime. Counts read with separators, a relation row says "seen in tests" with the count in its tooltip, and the legend names the dash only when the map has one. Stored Requests models change only when a project publishes again.
2. `council/narrow-top-bar` (B8-B13). Below 900 px the bar wraps and everything in it stays reachable, titles and chips start below it, the arrow legend folds into one button, the welcome stands clear of the outline bar and an open sheet, Help is one scrolling column that opens at its top, the reader keeps the file's path and its buttons apart, and search shows each path. Checked at 390, 320 and 800 px (200% zoom).
3. `council/keyboard-a11y` (C15-C17, C19, C20). One focus ring, search as a combobox with its count said once typing pauses, focus kept in the panel after selecting and after Esc, selections and places announced, menus that say their state and close on Tab out, the card menu giving focus back.
4. `council/arrow-evidence` (D21, C18). A shared trunk lists every arrow on it with the relations each carried when clicked; each Uses and Used by row opens the same arrow panel by keyboard; Esc goes back one step at a time.
5. `council/search-keeps-place` (E27, E28). Search to a part puts the old selection down, so the panel, the address and a reload name the part found, Back bringing the old selection back; the reader's back goes to the card it names.

Left, in order: A2-A7 (per-table effects on store arrows, counts with units and attribution, "14/15 seen" on mixed aggregates, untested endpoints visible, tables against Uses, the run behind the marks), then the focus review's endpoint inventory. Also left: B14 (a sheet you can shrink), D22-D26, E29-E31 and the visual system (F). Raised in review and not yet done: the endpoint found by search opens as a place rather than selected (a design call); every Uses row carries a second tab stop even for one relation.
