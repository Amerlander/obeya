## The canvas

A chapter of the [design doc](../design.md), whose header says how it is written.

The UI is a browser app, React + TypeScript, with a custom canvas: camera with fly-to,
unfold-in-place, semantic zoom, edge indicators, minimap, and a frosted top bar the canvas slides
under.

### The bar

The bar keeps no hint line: `?` (or the round `?` button beside "Neue Aufgabe") shows the legend of
mouse and keys as a box over the greyed page (`src/ui/help.tsx`), and Esc, `?` or a click beside it
closes it. The `?` button only teaches the key: opened by the button, the legend's foot says that
`?` opens it too and that the button goes once the key has; the first time the key opens it, the
foot says the button has gone, and it stays gone (per browser). Under its sections the legend has
the link „Wunsch oder Fehler melden“ (see Wishes for Obeya's makers).

Left in the bar, after the canvas switcher: the archive's button, the queue's and "Neue Aufgabe".
The queue's button counts the waiting cards (grey); a click lists them under it in turn, each with
what it waits for, the buttons that move it and a × that takes it out of the queue at once, like
"Aus der Warteschlange nehmen" on the card (back to planned; starting it again is the way back, so
there is no undo), and a row opens its card; a click beside the list or Esc closes it. The archive's button lists the archive under it the same way (`src/ui/archive.tsx`).
The bar's buttons are all one height.

The bar's buttons always fit into it (`src/ui/barFit.ts`): narrower than its contents, beside a wide
sheet or in a narrow window, it gives up in steps the wordmark for the sign and the branch, then the
labels for icons a few at a time, then the pool and `?`, then all but the sheets'
buttons. Which
step is measured (the bar's right end within its padding) whenever its width or contents change,
because the same width holds a short branch or a long one and one machine's clones or three.

The logo (`src/ui/logo.tsx`: three cards in the inks of working, waiting and approved, "obeya" in
Newsreader SemiBold as outlines) opens the bar, stands alone in the middle while the page loads,
above "offline" when the server is gone, and is the favicon; `bun scripts/logo.tsx` writes it as the
files in `src/ui/logo/`, the app's icon source with them (`bunx tauri icon app/icons/source.png -o
app/icons` makes the rest; keep only the files tracked).

### Creating cards

Manual cards are created by double-click or `n`, and edited in the unfolded card; it opens with the
cursor in the text field. The title is optional (its field says so): a card closed or started with a
text or screenshots but no title gets one from Obeya (`Koordinator.name`, a short read-only session
of the „Kleine Aufgaben“ group; the text's first line when it gives none), before its start is
judged; until then the canvas shows the text's first line, muted. A title the owner types meanwhile
stands. A new card closed empty is dropped, and so is one left empty by a closed page, on Obeya's
next start. Deleting offers undo.

An empty canvas names speaking first (hold Space and say what Obeya should build; the card appears
where the pointer is on letting go), the double-click second; above the notes on the plan
directories, with a fixed space between (it follows them when the view moves). The bar's "New task"
button only teaches the double-click: it opens a note saying so with one "Got it", and goes for good
(per browser) once the owner has created a card by double-click, which keeps the bar uncluttered.

### Cards on the canvas

A card has one fixed size; a delivered workstream shrinks to a chip once its agent is done (its
title alone, after its label from the plan doc, `W3`, so it still reads as its workstream), a
project wraps its children, and a workstream cannot be dragged out of its project. New projects are
placed in a grid below the existing ones. A proposal or follow-up goes below the card it came from,
or, when something is in the way there (for a workstream: its own project), to the nearest spot
clear of every card and project. The dashed line from a proposal, follow-up or prototype to its card
joins the sides that face each other (left and right when the two stand more beside than above each
other) and runs above projects but below cards, so a line from a workstream stays visible over its
project.

A project collapses to its head with the arrow before its title („Zuklappen“, „Aufklappen“), for
projects the owner does not work on, as on a canvas of a repository a team shares, where every
colleague's plan docs are projects. Collapsed, it is 440 × 84 px: its head (title, progress, the
start button, the badge of workstreams that need the owner) and below it a mark for each workstream
in its state's colour, brighter for one that needs the owner, whose title shows on the pointer and
which opens that workstream, unfolding from its mark. The workstreams stay on the project's sheet
and in the queue; an edge indicator for one that needs the owner points to its project. What stands
around the project keeps its place, and so does the project's own: the room it gave up is free for
other cards, and one put there may lie under the project once it is expanded again. Whether a
project is collapsed is kept on its row (`collapsed`), for this Obeya alone, never in the plan doc,
so it holds across reloads and on every device; a project that comes back from the archive comes back
as it was.

On the canvas, a planned card and one waiting in the queue show a play button while the pointer is
on them; it starts the card (the queued one anyway) without unfolding it. While the pointer is on a
card, the waits around it show (see Scheduling).

#### A project arranged by its dependencies

A project's workstreams can stand in columns by what builds on what: on the left what can start at
once, right of it what builds on it, each column a step further along the longest chain of open
workstreams it builds on (`arrangeWorkstreams` in `src/core/layout.ts`). Delivered workstreams are
no step on a chain and stay in rows of chips above. Within a column the cards follow the rows of what
they build on, so the arrows cross little, else the plan's order; a column holds four cards, more of
one step go on in a column beside it, with a wider gap before the next step for the arrows.

Which workstream builds on which, the Koordinator reads from the plan doc in a turn of its own (plan
docs say it in prose: "Needs W1", "after W2", or only in what a workstream uses): for each open
workstream the ones it builds on directly, delivered ones included. The reading is kept on the
project (`deps`) for the doc's workstreams as they stood (keys, titles and texts), and a workstream
waits, while the pointer is on a card, for the open ones it builds on as for those it waits for in
the queue (see Scheduling). The project's sheet lists the workstreams in the arranged order and
says what each builds on.

A project that comes with two open workstreams or more is read at once, and arranged once the reading
is there, unless the owner has moved one of its cards meanwhile; after that "Anordnen" in the
project's head ("Nach Abhängigkeiten anordnen" in its sheet) arranges it again, at once when the
reading holds for the doc as it stands, else after a new reading ("Ordnet an …" on the button
meanwhile). It takes effect at once, with „Rückgängig“ in the line above the microphone. A project
that grows into another card or project with it moves to the nearest spot clear of everything.

### Moving around

A card dragged to an edge of the view scrolls it that way, faster the nearer the edge, but only as
far as the rest of the canvas reaches plus room to drop the card beside it; a card picked up at an
edge scrolls only once the pointer moves towards it.

Panning, scrolling and zooming stop where the view would show no card any more: a strip of the
nearest card (120 px, or all of a smaller one) stays in sight above the minimap, so the owner never
lands on an empty view and pans back without the minimap. A gap between cards wider than the view is
crossed by the minimap. When cards go or the window shrinks and none is left in view, the camera
flies to the nearest; the minimap and the overview key land next to content too.

The minimap sits in the bottom left corner, as in tldraw, clear of the sheets on the right. A click
on it flies there; a press that moves lets the view follow the pointer on the minimap until it is
let go, gliding after it so a press far from the view does not jump.

### Unfolding a card

Opening a card takes 300 ms: a 130 ms flight brings it to the middle, then it unfolds in 170 ms;
closing runs the same in reverse. Fast enough not to wait on, long enough to keep the context.

An unfolded card is as tall as its content, up to the room from 12 px below the window's top edge
down to the microphone, beyond which it scrolls, and follows its content while open: a planned card
or workstream with a long text uses a tall monitor's height instead of scrolling in a small box.
Only a window too low for a panel of 320 px lets it reach under the microphone; where its bottom
lies under the microphone, the content gets that much room below it, so the last row scrolls up
past the microphone instead of staying under it. A card's row of decisions at its end stays in view at the panel's foot
(above the microphone) while a long text scrolls under it, with a line above it while there is more
to scroll to: a planned workstream whose plan-doc text runs past the panel shows „Agent starten“
without scrolling, as its card on the canvas shows its play button. A task whose conversation
stands alone is 640 px wide, the conversation's widest, and otherwise sized like a split.

A card with a conversation beside what it is about (an idea, a proposal, a task an agent worked on
with a result) is up to 1600 px wide instead, the conversation a third of the width (400–560 px), and as
tall as its taller column, at least 320 px, up to the room from 12 px below the window's top edge
down to the microphone; it stands in the middle of the canvas (left of a docked sheet), above the
microphone, and keeps at least a conversation's 640 px beside a sheet dragged wide. Beyond that room
what the card is about and the conversation scroll inside their columns, the panel not at all; the
panel shows no scrollbar of its own. Only a window too low for a split of 320 px lets the panel
reach under the microphone and scroll. A proposal's text box grows with its text up to the room
that leaves the reason below it in view, then scrolls. A card stands below
the top bar while it fits there; one that needs more room reaches over the bar, which the dim covers
while a card is open anyway, up to 12 px below the window's top edge.

### Sheets

The sheets on the right (Obeya's, a project's, a plan doc being read) are a sidebar docked to the
window's right edge, from top to bottom: a straight edge with a divider line, no shadow, no gap. A
sheet's heading keeps clear of the button in its top corner. Obeya's is headed only "Obeya", as its
button is named. The canvas is what remains to its left: the top bar ends at the sidebar, the
microphone with its lines and the confirmations above it, the edge indicators, the minimap's frame
and an unfolding card all keep to that rest. Opening a sheet moves the view left by half the sheet's
width, so the middle of the view stays its middle; closing it or dragging its edge moves it back by
as much (`besideSheet`). A card opened beside a sheet goes back to its view beside whatever sheet is
open when it closes; a project's sheet stays while one of its cards is open, under the dim. A window
up to 760 px wide lays the sheet over the canvas instead.

Obeya's button, a speech bubble with its counts, is the bar's rightmost; while its sidebar is open
the button stays where it was and becomes the sidebar's top corner, closing it again. Opening and
closing only change its colour: it is one element fixed over the room the bar keeps for it, never
moved into another parent. The other sheets have a ✕ there.

Esc closes any of the sheets, from a text field in it too, as from a card's field; a field being
edited (a preference, say) takes Esc first, to cancel the edit, and says so with a `data-esc`
attribute, which the canvas's key handler steps aside for. With a card open beside a sheet, the
first Esc closes the card, the second the sheet.

The sheets are as wide as the owner drags their left edge: one width for all of them, and one for
reading a plan doc, which follows the window until dragged. The browser remembers both; the canvas
keeps 240 px beside the sheet, and the camera keeps a project beside it; a double-click on the edge
goes back to the default.

### Visual identity

Index cards pinned to a wall, so that nobody takes Obeya for the stock AI-generated interface.
Everything is in `src/ui/styles.css` (the PTT panel's window repeats the tokens in `panel.css`).

- *The card*: off-white card stock (`--card`) on a warm board (`--bg`, dotted), corners nearly
  square (2 px), a short hard shadow instead of a soft blur, and the state as a rule across the top
  in its ink (4 px; 3 px on a chip; 8 px zoomed out, where the title also grows, so the state reads
  as a band from afar). No ruled lines. The owner's turn is an orange frame and a pushpin with "!"
  that pulses; an idea is on rose-tinted stock; a proposal is only pencilled in (a dashed outline,
  no stock); a queued card's rule is dashed; done and live cards fade and go slightly yellow (not
  while their agent still works after the landing: then only their state line is in the working ink,
  with the moving line). Under the pointer a card lifts a little; dragged, it tilts as if held in
  the hand. The moving line beside "at work" is a pencil stroke drawn again and again.
- *Inks* (light / dark): planned `#a0978a` / `#8a8274` pencil grey; working `#1d5fe0` / `#5b95ff`
  clear blue; waiting for the owner `#f27405` / `#ff8a1c` strong orange (frame, pin, pulse, every
  count of what waits); approved `#3d9a1f` / `#78c448` yellow-green; in PR `#08888e` / `#27b9b6`
  petrol; proposal `#7b4fd6` / `#a587ff` violet; idea `#dc2f5e` / `#ff6289` madder red; live and
  done `#b4ab98` / `#5f594e`. Failures `--error`, cautions `--warn`; what is written on a fill of
  ink (a badge, the play button) is `--on-ink`, white in light and near black in dark. Dark mode is
  black card stock written on in white pencil: its inks are as far apart as in light (blue and green
  never confusable, orange the loudest).
- *Light or dark*: as the system, until the owner chooses Hell or Dunkel under Allgemein in the
  Konfiguration dialog (three buttons side by side, the choice `theme` in `settings.json`,
  `/api/theme`). The page asks for it before its first render, as for the language, and sets
  `data-theme` on its root, which the stylesheets (`styles.css`, `panel.css`) read beside
  `prefers-color-scheme`; a choice applies at once, without loading again (`src/ui/theme.ts`). The
  PTT panel asks again each time the key is held, as it stays open while the app runs.
  `color-scheme` follows the look, so native controls and the pages in a frame (a worker's HTML
  artifact, a mock) take it too. The site and the shared demo pages keep the system's.
- *Type*: titles and headings in Newsreader (a serif with optical sizes; a plan doc read in the
  sheet is set in it too), everything else in IBM Plex Sans Condensed. Both are under the SIL Open
  Font License and served from `src/ui/fonts/` with their licence files (latin subsets from
  Fontsource); Google Fonts is not loaded. Code stays in the system's monospace.
- *Carried through*: pills, menus, the panel, the sheets, dialogs, buttons and fields use the same
  palette and type and the same nearly square corners (3 px, 4 px for project frames), with the
  cards' hard shadow, but no paper texture of their own. An unfolded card keeps its rule across the
  top. Dots, the microphone, spinners and the pin stay round. The site and the shared demo pages use
  the same palette and type.

### Groups on the canvas

Each group shows as a territory behind its cards (`src/ui/groups.tsx`, `src/ui/territory.ts`): a
soft, slightly glowing outline over a faint area in the group's colour, with a dotted line inside
along the cards. Group colours appear only there and in the minimap, never on a card, so they do not
compete with the states' colours. Zoomed far out, the groups' names stand pale over their
territories.

A territory is the contour of an energy field (Bubble Sets): the group's cards pull, near cards are
linked so they share one territory (not across another card), and every other card pushes back;
where two groups meet, the stronger holds the ground, which makes a card amid another group an
island. Of the cards' pull only the strongest counts at each point, not their sum, and the narrow
gap between two cards facing each other pulls like a card: summed, the edge bulged out over every
gap. A card's pull is squeezed on a side that faces another card across a narrow gap, so the edge
runs along the gap's middle the whole side long and turns round there: pushed back only near the
other card, it hung down beside it as a tip at the corner.

The browser computes it with `d3-contour`, each group on its own grid around its cards on one 16 px
lattice, resamples each contour evenly and smooths it with a Gaussian (σ 20 px), so corners come out
round and even rather than with the grid's facets and the kinks where territories meet, and computes
a group's field again only when something within its reach moved, its contour only when its own or a
neighbour's field changed; one that took longer than 8 ms makes the next wait, so a dragged card
keeps the frame rate and its territory follows a little later. At rest nothing is computed and
nothing moves. Measured in headless Chrome on 100 cards in four groups that all overlap
(2026-10-05): the first computation 21 ms, a move that changes all four 5 ms (median; 14 ms at
most), dragging at 60 fps, nothing at rest.

When cards change group, wherever the change comes from (the colour ring, the Koordinator, another
page), a wave runs out from where it was assigned (else from the cards' middle), reaches the cards
one after the other, and their territory springs out a little too far and settles; a light runs once
along the new edge. The wave is over in 0.9 s: see the decision on large animations below.

Marking: Shift + drag on the canvas draws a lasso (without Shift it pans as before), Shift + click on
a card takes it in or out (a workstream: its project, as in the lasso; Shift + click beside a
project's workstreams marks the project); a lasso adds what it caught to what is marked
(`src/ui/selection.ts`). Marked cards carry drifting dashes, and over their top right corner (below
their bottom where the bar leaves no room) a line says how many are marked, with the button „Gruppe …“
for the colour ring. Dragging a marked card moves all marked ones by as much, each saved where it
lands; dragging an unmarked one moves it alone and leaves the marks. A click on the empty canvas or
Esc lets go of them; a click on a card opens it as ever. Two hints teach it, each until used once:
after a card was moved alone, for a few seconds where it was let go, how to mark several; beside two or
more marked cards, that dragging one moves them all.

Assigning: the button over the marked cards, or a right click on a card, which takes that card (a
workstream: its project), or all marked ones when it is one of them; either opens a ring of colour
balls with the groups, "+" (a new group, named in place) and "∅" (none). Each group's name stands
outside its ball, so all show at once, with how many of its cards are still to be done (not
finished, archived or a dropped idea; a project counts by its workstreams): a group at 0 goes pale,
a candidate for deleting. Behind the ring and the names the canvas steps back under a frosted halo
that fades out at its edge, so they read on a busy canvas. While the ring is open the canvas behind it holds
still: its endless animations (the selection's drifting dashes, a working card's line) pause. Moving towards a ball or onto its name
picks it, a click takes it, Escape closes the ring. The picked group's name carries a ×: it deletes
the group (its cards, archived ones too, belong to none), and "Rückgängig" brings it back in its
colour with the same cards.

By voice, the Koordinator's `group` (cards into a group by name, a new name creates it), `ungroup`
and `rename_group`; it sees each card's group and the canvas's groups. The API: `POST
/api/c/<canvas>/groups` (name and first cards, a colour when one comes back; a name a group has
already takes that group), `PATCH …/groups/<id>` (name), `DELETE …/groups/<id>` (returns the group
and its cards), `POST …/assign` (cards and a group, `null` for none); the snapshot carries the
groups, every card its group.

### Refusals

The server words no UI text for refusals: it answers `{ code, error }` with a stable code
(`ErrorCode` in `src/core/types.ts`) and an English detail, for developers, and log entries of a
failed start carry the code too. The UI shows its text for the code from `src/ui/strings.ts`, a
generic one for anything else.

### Decisions

- **The look is the index card** (2026-10-10). Two prototypes were built side by side: the index
  card and a Swiss editorial card (a square black frame, a solid state band, Schibsted Grotesk),
  which was sharper from a distance but closer to a known designer style. A seal (a kanji stamp for
  the state) and a kanban ticket (ruled fields, a punched hole) were not pursued. The index card's
  ruled lines were dropped, and its inks made clearer than its first version's fountain-pen blue and
  bottle green, which stood too close together. Before, a card was a white box with 14 px rounding,
  a soft two-layer shadow, a 5 px state stripe down its left, all set in Inter, with Tailwind's
  default colours for the states.
- **Groups show as contours behind the cards, drawn in SVG**, rather than a WebGL shader
  (2026-10-05). Three prototypes were built: a shader with waving "plasma" areas, one with
  territories and a drifting honeycomb, and contours. All ran smoothly at about 30 cards; the owner
  chose the contours, which are calm, need no WebGL and cost nothing at rest, over the shaders'
  livelier look, which costs frames all the time. The territories animate only when something
  changes.
- **Nothing on the canvas animates a large area for a second or longer** (2026-10-15). Chrome's
  screen capture (a demo's screencast, a shared tab) locks onto a large area that changes every frame
  for about a second; once it stops, the capture drops every other change for about 0.27 s, while
  the window itself keeps drawing. On the hero video's canvas that left two gaps of 267 ms in the
  recording: when the ring closed (the selection's dashes drifting under the halo made its blur
  render again every frame) and when the wave ended (then 1.5 s). Now the canvas holds still behind
  the open ring and the wave lasts 0.9 s. Dropping the halo's blur would also have closed the first
  gap, but left the cards' text readable behind the ring's names.
- **The lasso marks cards instead of opening the colour ring** (owner, 2026-10-21). A colleague
  wanted to move several cards together (Shift + click, a frame), and the lasso went straight to
  the ring, so cards could only be grouped, not marked. Keeping the lasso's ring and letting a drag
  on a marked card close it was the other option; the owner chose marking first, as in Figma or
  Miro, with grouping a click away, so the ring and its halo do not come up on every move.
- **A group ends with its last card**: it is made by putting cards into it, so there is never an
  empty group to clean up. Deleting one ends it at once by taking its cards out, for a group whose
  last cards sit in the archive, out of reach of the ring (2026-10-06).
- **A project the owner does not work on collapses rather than going away** (2026-10-21). A
  colleague on a shared repository wanted to see only their own projects and to dismiss plan docs
  for themselves alone. Considered: hiding a project into a list of its own beside the archive, with
  an optional filter on the doc's git author („Nur meine Projekte“). The owner chose collapsing: the
  project stays in sight, small, and needs no second list to bring it back.
- **Placement and lines** (2026-10-05): a proposal or follow-up finds the nearest free spot when its
  own place is taken; the dashed line to its card joins the sides that face each other and runs
  above projects but below cards.
- **Edge scrolling and the panning limit** (2026-10-01): a drag scrolls only as far as the canvas
  reaches, and the view never lands on emptiness. The minimap follows a moving press (2026-10-06).
- **The `?` and "Neue Aufgabe" buttons only teach** (2026-10-15). Until then the `?` button stood
  there always, and "Neue Aufgabe" created a card in the middle.
- **A card's title is optional** (2026-10-15). Before, a card needed a title, the cursor started in
  the title field, and a card closed without a title was dropped with its text.
- **Archive, queue and "Neue Aufgabe" sit left in the bar** (2026-10-09). Until then the queue was a
  section of the Koordinator's sheet, counted on Obeya's button, and the archive's button sat on the
  right.
- **The bar measures what fits** (2026-10-12). Until then two container queries on the bar's width
  chose the step, and a long branch, a large pool or a restart's notice pushed the buttons past the
  bar's end under Obeya's button and the sheet.
- **An unfolded card is as large as its content, up to the room it has** (2026-10-08). Before it
  filled that room, with empty space below a short conversation and a short brief on a large screen,
  and a scrollbar stood at the panel's right edge whenever the content came out a few pixels higher
  than the panel. Before it filled the room it stayed at 1120 × 880 px with the columns 600 px high,
  small on a large screen. Since 2026-10-09 a card may reach over the bar: before, the bar's 64 px
  stayed free, which cost a card on a window of moderate height much of its room.
- **A proposal grows with its conversation too** (2026-10-21). Before, only its text and questions
  set its height (up to the screen's), and the conversation filled that height and scrolled in it:
  a proposal with a short text and a long conversation stayed small with a scrollbar beside unused
  room on a tall screen.
- **The sheets are a docked sidebar** (2026-10-06, 2026-10-09). Before, the sheets were rounded
  panels with a shadow floating 14 px from the window's edge over a full-window canvas: cards were
  cut off at their edge, and the microphone and its lines stayed in the window's middle, partly
  under them, so a sheet wide enough to reach the microphone ended above it and its height jumped as
  it was widened. Obeya's button becomes the sidebar's corner (the owner's wish): before, closing
  put it back into the bar, which still ended at the sidebar, so it showed up left of it and slid
  right with the bar. Until 2026-10-12 Obeya's sheet was headed "Obeya" over "Planung und
  Präferenzen", which ran under the button. Until 2026-10-14 Esc left Obeya's sidebar open and did
  nothing in any sheet's field. The sheets' width is dragged (2026-10-02).
