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

## Status, 2026-11-25: scored rounds and landing

After the five branches, a sixth, `council/score-polish`, ran four scored rounds. Fable 5.2 and Astra 6.2 (Codex) each scored UX and UI out of 10 against the running viewer, then re-scored after each round of fixes. The target was at least 8.5 from both seats on both axes, with at least one 9.

| Round | Fable UX | Fable UI | Astra UX | Astra UI |
|---|---|---|---|---|
| 1 (after the five branches) | 7.4 | 7.6 | 6.7 | 7.5 |
| 2 | 8.3 | 8.1 | 8.1 | 8.5 |
| 3 | 8.5 | 8.3 | 8.5 | 8.8 |
| 4 (final) | 8.7 | 8.5 | 8.7 | 8.9 |

Both seats reached 8.5 on both axes. No seat gave a 9; Astra's UI at 8.9 came closest. After round 4, only the fixes both seats agreed on were applied: the rotated phone is fitted once its relayout settles, and phone breadcrumbs keep the current place. Two defects Astra found were also fixed: the open sheet's Hide button showed no focus ring, and an arrow heading said ↔ for relations that run one way.

This round closed A2-A7: per-table operations on store arrows, counts with their units, "14/15 seen" with the exceptions first, untested endpoints shown in amber and listed under the app's coverage, tables as a list, and the test run in plain view. It also closed B14 (a phone sheet that folds to a grip) and parts of D, E and F.

The publisher now records each table's operation and gives each step its own count (`scripts/observed.mjs`). Stored maps pick that up the next time a project publishes with `--trace`.

Open, from the final round, ranked by the gain the seats expected:
- **Endpoint inventory.** Both seats.
  - An app should list its endpoints in both views: Endpoints · 67, with method filters and Unseen · 4.
  - Searching an endpoint's route in Architecture should offer it from Requests.
- **The address reproduces the view.** Fable. Write `in=` and `at=` together, and on load frame `in` and select `at`.
- **Switching views keeps the request.** Astra. A step reached from Withdraw returns to Withdraw, not Buy.
- **A mapped relation and measured traffic are told apart on store arrows.** Astra. Show "1 mapped runtime relation", the endpoint's requests and the tables touched, with the hop's own count marked as not measured.
- **Search groups a shared file's occurrences.** Astra. For example, KingdomRepository · 32, expandable, before the result cap applies.
- **Fill sparse containers.** Fable. Children should cover about 80% of a container's body.
- **Fit the 1920 overview to the stage.** Fable. Then nested titles in the overview reach about 10 px.
- **Long repository step names get two lines.** Astra. The code preview moves down a line to make room.
- **Supporting types get a shorter row and their own glyph.** Astra.
- **Touch targets of 44 px** in the bar and crumbs (36 and 28 px now). Fable. The reader head at 320 px should take one row.
- **Small items:**
  - the held container's kind is clipped at the screen edge on phones;
  - a chip can sit on a container's lens value;
  - a landscape phone does not fit the map to the full width.

Still open from the first backlog: D22-D26, E29-E31 and the rest of F. The endpoint inventory above also covers the focus review's first item.

## Status, 2026-11-26: stream 3, visual system and layout

Stream 3 of the [open work](2026-11-25-open-work.md) closed the layout and visual items of the open list above, and D22-D26, E31 and F32-F34. Each item has a black-box check in `scripts/controls-test.mjs` (two in `answers-test.mjs` and `place-test.mjs`), before and after screenshots at 1600×1000, 390×844 and 200% zoom, and a review by Codex (gpt-6.2-astra, xhigh) whose blocking findings were fixed and checked again.

- **Fill sparse containers.** A level of two or more parts fills its container to a margin of half a gutter, its cards stretching up to 1.4 times on one axis: on knights a level of parts covers 61-88% of its body, against 19-74% before. Files, and a part alone in its container, keep to a 2 × 2 grid's card (the earlier rule that a one-file app opens with its siblings), so a level of files fills only as far as that allows. That is a trade-off between the two asks, decided here.
- **Fit the overview to the stage.** The whole map is packed for the stage's shape, trying several aspect targets and keeping the largest, and packed again in place when the stage changes shape. A phone on its side fills its width (zoom 0.43 to 0.53). At 1920 the server's cards are titled at 13-14 px.
- **Long step names** take two lines, broken at a word or a CamelCase hump, their code a line lower. "KingdomOngoingAttackJpaRepository" (33 letters) still does not fit two lines at three quarters of the size and stays cut.
- **Supporting types** stand on short rows of their own, with a braces glyph.
- **Touch targets** in the bar and crumbs are 44 × 44 px on a touch screen; the reader's head is one row at 320 px.
- **The small items:** the held container's kind stays on screen; chips keep off lens values and the lens legend.
- **D22** arrows in a level of few run in lanes of their own; **D23** a selection keeps an arrow's kind (a violet rim for a runtime call, type-only dotted); **D24** was already fixed; **D25** chips keep off both legends; **D26** card edges inside an open container read at about 3:1.
- **E29 and E30** came with stream 1 (search groups a shared file; picking a feature shows it in the panel). **E31** the lens legend names a level's least and most, the map's range apart.
- **F32** text is 13 px with 11 / 15 / 19 px tiers, nothing smaller; the details column is 360-420 px. **F33** each accent has one meaning: amber what goes out, cyan in, violet runtime and cited lines, green seen, light red not seen or stale, pink features, white focus and actions. **F34** the column runs to the foot while the minimap is away; small person cards are cards, not pills; the welcome says how many features more; rail ticks are larger and in order; Vite no longer scans uploaded sources.
- **Focus review item 9.** Connections is now **Coupling**, a layout of Architecture (Layout: As mapped, By coupling; `?layout=coupling`), not a view.

Known edge cases left in fitting the map to the stage, after seventeen review rounds (each round found a narrower timing race between a window resize, a live map update and the reader's own input; the common cases are covered by checks in `controls-test.mjs`): a card framed before a resize can end up off-screen when, during the same live update's morph, an identical update arrives or the window's height changes. Pressing the card again, or Fit, frames it correctly. Fixing it means one camera model for "what the reader asked to see" that every resize, morph and flight consults, not another special case.

**Closed, 2026-11-27.** The viewer now keeps one camera intent in `main.ts`: a card by id, the whole map, or free (the reader moved the camera themselves, or a jump such as Back or a problem left it somewhere no framing names). Picking a card, the crumb, Fit and a link's place set it. One function, `reframe`, works the camera out from it for the map and screen as they are now. Every resize, every settle of the bar, every relayout and every step of a live update's morph calls it, so a repeated update simply morphs on from wherever the last one had got to. Each call either sets the camera or, during a flight, sends the flight to the new end. `Camera.aim` bends the flight toward that end on its own clock, so a moving target is met when the flight was due to land, and resizing never restarts or stalls it. The intent ends only when the camera is moved outside `Camera.steer`: the page steers inside it, and any other move (wheel, drag, glide, keys, minimap, Back, a press that stops a flight) calls `Camera.onHand`. That replaces nine pieces of state: `framedAt`, `atFramed`, `atWhole`, `headedFramed`, `headedWhole`, `framedCard`, the 150 ms re-aim timer, `refitAfterMorph`, and the morph's `last`, `resized` and `flying` marks. It also replaces the position comparisons that guessed whether the reader had moved. A free camera still moves with the selection, or the card at the centre, through a live update and a relayout. A card framed and then resized is now framed again for the new window, where before it was only scaled.

The race on knights, before the change: a card framed before a resize was left 10 px off its framing when the same update arrived during the morph, and 91 px off when the height changed during it. It stayed on screen there, but at the old layout's zoom. Five checks in `scripts/live-test.mjs` cover this: the two races, the whole map through a repeated update and a height change, a drag during the morph being kept, and a jump of the reader's own (the minimap, Back) under way when an update arrives landing where it was going. The two races failed on the old code; all five pass.

A review by Codex (gpt-6.2-astra, xhigh) found five blocking cases the model still got wrong, all reproduced in the running viewer and now fixed, each with a check that failed before its fix:
- **A framed file given its first part** zoomed to 434,000× for a frame and could leave the map blank. Halfway through a morph, a container opening from nothing has a near-zero opening scale of its own. The framing now takes that scale from the layout the update ends at, scaled to the card's size at that moment.
- **A sideways scroll** zoomed by a factor of 1, and that dropped the intent. A zoom of 1 is now no move.
- **Aiming a flight mid-way** jumped the zoom, because the whole elapsed share of the new end applied at once. The bend toward a new end now starts at zero at the moment of aiming and is complete when the flight lands.
- **The same update repeated after a drag** took the camera back. A camera the reader took during one update's morph stays theirs through the next.
- **On a phone, the sheet opening after a selection** nudged the camera as if by hand, dropping the intent. When the selected card is what the reader asked to see, it is now framed again for the open sheet.

Two of Codex's non-blocking notes were also taken. A framed card that an update removes now falls back to the nearest part that still holds it. Failing live checks now set the exit code.

A second Codex round confirmed those five fixed and found seven more. Four came from the first fix for the file-given-a-part case, which eased the camera toward the final layout's framing rather than following the card. That let a flight land on an empty spot, let the next morph frame undo Fit, let a turned phone hide the card under the bar, and let a container outgrow the stage halfway through. Following the card where it is now, with only its opening scale taken from the final layout, removed that easing state and fixed all four. The other three:
- A drag followed by a *different* update now moves the camera with the selection from where the drag left it. Only the same update again keeps the camera where the drag put it.
- Closing the code reader on a phone frames the intended card again for the sheet it hid.
- A sideways scroll records no trip for Back.

Each has a check in `live-test.mjs` that failed on the first-round code.

A third round confirmed those seven fixed and found two more, both now fixed, each with a check that failed on the second-round code:
- **"The same update again" compared rect slots, not cards.** An update with its rows reordered counted as a different layout, and the reverse could happen too. It now compares each card's final rect by id, and any card added or removed makes it a different layout.
- **The final layout's opening scale was applied to a container already open.** A container emptied of most of its cards dropped from zoom 36.9 to 12.7 in one frame, leaving its cards undrawn.

Fixing the second exposed the real rule for a framing during a live update's move. Following `frameFor` on the half-moved layout can never be smooth, because `frameFor` has thresholds: a container switches from "too crowded to open, framed from its corner" to "framed whole" at some point during the move. So `frameFor` now runs only on the two fixed layouts the move goes between. The framing used mid-move (`frameNow`) blends, by the move's progress, how each of the two layouts frames the card relative to the card itself: its offset and its on-screen size in card widths. That blend is laid on the card wherever it is at that moment. Where the camera stood off that framing when the move began, the gap closes linearly over the move. The start layout of a card that opens from nothing takes its opening scale from the end layout. The card's on-screen size therefore always lies between its two endpoint sizes, and the camera never jumps. A flight to the card is aimed at this framing each frame.

A fourth round confirmed all fourteen earlier reproductions and found four more, each now fixed with a check that failed on the third-round code:
- **Turning a phone during the move reapplied the old screen's gap**, which made a card 4,280 px wide. The gap is now dropped whenever the screen or the bar changes.
- **and 3. Deep in a map**, a card a screen wide is about 10⁻¹⁰ world units across, so absolute tolerances of 10⁻⁹ read real moves as none. A card selected mid-move was framed at its destination, and a different layout passed for the same update. Sizes are now compared with zero, and layouts exactly (layout is deterministic).
- **A container open before a move could dip below its opening zoom halfway** when the map around it filled at the same time, hiding its cards for 64 ms. It now keeps at least its opening zoom at its current scale throughout, the threshold `frameFor` itself uses.

Codex's verdict was land after fixes in each of the four rounds. Every blocking finding is now fixed: 30 live checks in all. One timing window is left on purpose. A flight aimed somewhere new in its last millisecond or so (eased progress within 10⁻⁶ of the end) lands there in that frame, as a settled framing would on a resize.
