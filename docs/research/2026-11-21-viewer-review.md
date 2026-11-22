# Viewer UI/UX review, 2026-11-21

Two independent reviews of main at `8b9beaf`, by Codex (gpt-6.2-astra, xhigh) and Fable 5.2. Each drove the running viewer with real mouse and keyboard input on several maps (zoom-in-architecture, knights-of-darkness, petclinic, excalidraw, galaxy-wars, RealWorld Gin, synthetic 10k) at 1600×1000, 1280×720, 1920×1080 DPR 2 and about 900 px. Neither saw the other's report. The coordinator merged them into a plan and both reviewers then critiqued that plan. This file is the result, ordered by importance. The full reports (about 200 findings, 376 screenshots) were working files and are not committed.

Coordinator checks in code before ranking: `openCode` finds the card by file path, and double-click always opens at line 1 (`spike/src/main.ts:210`, `:254`); the request builder takes words from inside string literals (`spike/scripts/routes.mjs:15`, `:308`); `rep()` lets only the focus and its ancestors take edges early (`spike/src/render.ts:291-313`).

## Verdict

Both reviews: the continuous zoom from landscape to source line, with closed cards that summarise their contents and a cited line one click from its code, is the product and works. It is not yet trustworthy for its central question, "what talks to what": the map gives wrong answers in three places, and the details panel is the only reliable list of dependencies but is hard to read. Rendering is not a problem: 10k elements hold about 17.7 ms per frame.

## Ordered improvements

Effort: S under a day, M a few days, L a week or more.

### A. Stop giving wrong answers

1. **Requests invents steps (M-L).** PetClinic `GET /owners/find` shows OwnerRepository and a database arrow for a handler that only returns `"owners/findOwners"`: the word `owners` inside the string matches the controller's `owners` field. Keep reading strings for view names, but never as identifier uses. Also: types the handler only names are numbered as steps, alternative responses (`GET /owners`: none, one, many) appear as successive steps, and a method that cannot be resolved falls back to following the whole file (`routes.mjs:352`). Each step needs a source span. A handler may end at a template, a redirect or a response. Branch only where the source branches. Acceptance: `GET /owners/find` = handler → template → HTML response.
2. **Opening a request step's code jumps to another endpoint at line 1 (S).** The card is found by path, so a file shown in many endpoints opens the first one. Pass the element index. Store both the route line and the method's first line (KoD: 165 and 166; Gin login: 15 and 117) and open at the method. Acceptance: both lines keep the endpoint id.
3. **Selecting a card at a level that has just opened dims the siblings it uses (M).** KoD: select War; the panel lists 7 outgoing, but the map dims them and draws no arrows. Fix it in `rep()`. Invariant test: every card the panel lists is drawn undimmed, on both sides of the open threshold.
4. **The panel hides callers (S).** Excalidraw `utils.ts`: "Incoming · 154" with 40 rows (`details.ts` `slice(0, 40)`). Fold into the panel rebuild (8).
5. **Back records the wrong place (S).** A panel row calls `select(j)` before `go(j)` (`main.ts:228`), so Back restores the new selection. Wheel and drag excursions are never recorded, so Back says "No earlier place" after exploring by hand.

### B. Cut first (cheap, and it shrinks everything after it)

6. **Remove:** the radial command wheel and hold-right flick (the flick does not work in Chrome on Windows), routes (Player → Game database returns seven hops backwards through the test tools), the timed tooltip lock and nested tooltips, sound, the last rung of the Esc ladder, the bottom-right shortcut sentence (replace it with a visible Help button), and frame stats in the user palette. Esc dismisses one layer. **Back** is previous place and **Parent** is up. `.` / `,` work only in Connections and stay at the level. Fix the README's sound button claim.
7. **Plain bugs for keyboard users, in the same batch (S):** closed overlays take Tab focus (the invisible palette input accepts typing), map shortcuts fire under open Help (`.` moves the camera), and Esc on the model menu also clears the selection. Fix with `inert`/`hidden`, Help as a dialog, and shortcuts scoped to map focus. Also in this batch: WCAG AA contrast for `#64748b`/`#475569` text (search paths are 2.5:1 and they tell same-named files apart), `prefers-reduced-motion`, and flights capped at about 700 ms, ending on any input.

### C. Make "what talks to what" readable

8. **Rebuild the details panel (M).** Every relation as one line first, with Uses and Used by both always present ("none on this map"). Evidence opens on click, with identical excerpts shown once but still linked to each relation. Lists are complete and keyboard reachable. Citations are buttons. Files get path, line count, Copy path:line and a **Read code** button. A rank reason in Connections ("#3 of 6 · reaches 3 of 5 peers · 12 relations"). One vocabulary everywhere: **Uses / Used by**. Design it as the first half of the accessible outline (16).
9. **`]` / `[` walk the panel's rows (S).** Same list and order as the panel, active row highlighted, no camera move when both cards are on screen. With nothing selected the keys do nothing and say so. Today they walk 21 leaf files against the panel's 7 groups.
10. **Emphasis rules (S).** Selection colours only edges that cross its border. Hover brightens without dimming the map. Search travel to a container frames it without selecting it, so it no longer floods the view with glow. A selected endpoint emphasises its own steps, not its externals.

### D. Keep the place, read the code

11. **The place lives in the URL (M):** model, view, node id, optional file:line and lens. Browser Back and Forward work, links can be shared, and switching view reloads onto the same subject; map across views by file path, since Requests ids differ. The animated in-place swap can come later.
12. **Reading mode, by explicit open only (M):** double-click, Enter, Read code or a cited line. It shows one column with native scrolling, selectable text, a header with path:line, Copy and "← back to <parent>", and ticks for marked and cited lines. Chips, minimap and help are hidden. Wheel-zooming into a file keeps zooming and at the cap says "Enter to read". "Open in editor" needs a configured local checkout root, so it comes second. Double-click, Enter and Read code are one action.
13. **No silent stops (S).** The wheel freezes over a gutter with no message. It should slide onto the nearest card or say so. The stretch where a file card fills the screen but shows only a thumbnail should show path, line count and marked lines. The empty-space hint gets a "Fit whole map" button.

### E. Search and the first minute

14. **Search (S-M).** Rank features and part titles first (exact, prefix, word prefix, substring; subsequence only as a last resort), and let an exact file path win over a weak feature match. Group results as features and parts, then files. An empty query lists the map's features and recent places, with commands behind `>`. Fix the no-match flow: the suggested query runs a different row than the one highlighted, and the reopened palette closes after about 120 ms. Today "spy" puts "Spies and reports" ninth.
15. **First run (S).** A sentence on what the product does, generated counts (KoD: 6 parts, 261 files, 19 features), and clickable starting features. The hint stays until dismissed and shows at narrow widths. A legend for card colours and arrow thickness sits behind Help. Unknown model or view gets a readable message; a failed source fetch says so instead of drawing an empty card.

### F. Access, arrows, chrome

16. **Minimal accessible outline (M-L):** the current level as a keyboard-operable list (name, kind, children, uses and used by) kept in sync with the selection, with toasts as a live region and the page title "<part> · <project>". Acceptance, keyboard only with NVDA: find War, name one dependency, open its citation, return to War. Arrow-key selection between cards comes after.
17. **Arrows you can attribute (L, staged).** First: no resting edges at file level past about 12 cards, and no "2 relations"-style labels. Then hover or focus on a trunk names the pairs it carries. Last: counts beside the arrowhead instead of mid-trunk.
18. **Chrome and layout (M).** One top row: model picker, breadcrumb, Search, a labelled **View** switch and a **Colour by** menu. The details panel owns a column on wide screens instead of sliding the map, and becomes a bottom sheet under about 1100 px. Chips never sit on card text. Labels are clipped by measured width (KoD's `MarketOfferJpaRepository` runs into its neighbour). One title size per level. Sub-lines under 9 px are not drawn. Kinds read as words ("21 files", "Endpoint", "Response"). Lens colour goes on a stripe, never under text.
19. **Decoration out (S):** starfield, warp, glow frame and brackets replaced by one thin focus outline, and particles at most on one hovered edge. Live-update toasts name what changed (edges and evidence included) and drop the timing figures.
20. **Requests layout (M):** after item 1, show each endpoint as an ordered sequence with branches, a method tag and the full path, named types in a separate unnumbered row, and the ordered steps listed in the panel too.

### Then: the feature as the unit of navigation

Both reviews' bold ideas meet here. Pick a feature; the map stays put and lights only the cards that carry it, across apps, and the panel tells it top to bottom with evidence. Feature tags establish which cards take part, not the order. The trail has to come from evidenced calls, through untagged files where needed, and say where the evidence ends.

## Status, 2026-11-22

All twenty items are on main, each with black-box checks: `scripts/answers-test.mjs` (1-5, 10, 17), `scripts/controls-test.mjs` (6, 7, 14-16, 18), `scripts/place-test.mjs` (11-13, 20), plus the updated `publish-test.mjs` and `live-test.mjs` (19). The Requests builder fixes (1) came from a parallel branch, merged as is; stored Requests models change only when a project publishes again (knights-of-darkness was republished locally from its own checkout, same commit).

Departures from the plan, and why:
- The details panel became a permanent column on wide screens (18), and with nothing selected it is the keyboard outline of the level (16): one place for both, so the column is never empty and the map never resizes or slides.
- Search keeps a feature as a result of its own: picking it frames the cards that carry it, a small first step toward the feature as the unit of navigation.
- Not done: arrow-key selection between cards (16 said "after"), "Open in editor" (needs a configured checkout root), an in-place animated view switch (11 said "later").

## Open decisions, taken as defaults

The owner can reverse any of these; each is one change.
- **Pins: removed.** URL places, browser history and the recent places in an empty search cover them; it keeps the control set small.
- **Coupling lens: kept,** under Colour by. It costs no control of its own now, and Codex's point stands: it shows crossing volume in the map's own layout.
- **Minimap: kept,** hidden while the whole map is in view and while reading code, its box clipped.
- **Stale map: amber after 14 days.** The viewer never reads a project, so it cannot know of a newer commit; age is all it has.

## Open decisions for the owner (as raised by the reviews)

- **Pins:** Fable says remove them, since URL places and recent places cover them. Codex says keep one "Save place" action and a Saved group in Search, because a deliberate shortlist outlives recency.
- **Coupling lens:** the merged plan dropped it as a duplicate of Connections. Codex points out that it shows crossing volume in the map's own layout, while the Connections rank also weighs reach.
- **Minimap:** both keep it, provided it is hidden while the whole map is on screen and while reading code, and that its viewport is clipped. Fable would cut it if those conditions slip.
- **Stale map warning:** amber after N days (Fable), or only when a newer revision is known (Codex).

## Every phase ships with its black-box scenario

Items 1-3 share one end-to-end run on petclinic and knights-of-darkness. Each later item names its scenario before work starts.
