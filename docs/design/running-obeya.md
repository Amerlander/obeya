## Running Obeya

A chapter of the [design doc](../design.md), whose header says how it is written.

### Server

Bun, TypeScript. HTTP + WebSocket to the UI, one API per canvas (`/api/c/<canvas>/…`,
`/api/canvases` lists them); SQLite (`bun:sqlite`) under `~/.obeya/`. `obeya <repo>…` starts one
canvas with the given repositories (`--name` names it); `obeya` starts the canvases
`~/.obeya/canvases.json` lists, `obeya --config <file>` those of another file. Without that file
(the first start) it serves no canvas, and the page is the setup assistant (see Setup assistant).

One Obeya per home (`src/server/instance.ts`): a running one writes its port, its pid (the
supervisor's) and whether the app started it into `server.json` in its home, and a second start on
that home says where the first runs and ends, instead of serving the same database beside it. An
entry whose process is gone, or alive but silent for 5 s (another program that got the pid), counts
as stale. A supervisor whose server ends to start again marks its entry `restarting`, and a start
meanwhile waits for it up to 90 s (new dependencies are installed first), so the app started during
a checkout's self-update opens that Obeya instead of serving the home beside it.

The app and a checkout share the home (`~/.obeya`, `OBEYA_HOME` moves it for both): canvases,
settings, voices, models and worktrees carry over, and workers one of them paused the other resumes.
An Obeya older than the database (`PRAGMA user_version` above its migrations, written by a newer
checkout) leaves it alone and says to update instead of failing later. The database starts from the
schema Obeya was released with (`SCHEMA` in `src/server/db.ts`, `user_version` 40, the steps it took
before); later changes are migrations after it. The first converts what an Obeya before the release
kept in shapes that changed since, so no code reads those shapes. A database an Obeya before the
release left below that schema is left alone too, with the commit to start once to bring it up to
date (`OlderDatabase`).

#### Who may talk to it

Only the owner. The server listens on `127.0.0.1`, which every program and every account on the
machine reaches, and some routes run commands as the owner (a demo voice that is a command, the
configuration, approving work). So two checks come first for every request and every WebSocket
upgrade (`src/server/access.ts`): that it comes from Obeya and no other site, and that it names the
owner (`src/server/owner.ts`).

*Its own site.* Any page open in the owner's browser may send requests to `127.0.0.1` (a
`text/plain` POST needs no preflight, and `req.json()` parses it all the same), and a DNS name
rebound to `127.0.0.1` reaches it under that name. So a request's `Host` (and `X-Forwarded-Host`,
where a proxy set it) names one of Obeya's own names (`localhost`, `127.0.0.1`, `[::1]`, and while
other devices reach Obeya the tailnet name or the address it listens on; the port is not checked),
else 421; an `Origin`, where it has one, is Obeya's own (scheme, host and port of the address it was
sent to, as `X-Forwarded-Proto` and `-Host` say behind `tailscale serve`), and it carries no
`Sec-Fetch-Site: cross-site`, else 403. A link from another site that opens one of Obeya's pages in
the browser's window passes all the same (a GET outside `/api/` with `Sec-Fetch-Mode: navigate` and
`Sec-Fetch-Dest: document`): it only shows the page, as typing the address would, and a phone
scanning the QR code often arrives that way, from the scanner app's page. In another site's frame
the page still gets nothing. Requests with neither header (the app's shell, scripts) pass this
check. The page and the push-to-talk panel are checked too: Bun serves an HTML bundle past
any handler, so each moves to a path made up at every start and its own path fetches it from there
once the request passed.

*The owner's key.* A request from this machine names the owner's key: 32 random bytes in
`owner.key` in Obeya's home, made at the first start, readable by the owner's account alone (0600;
on Windows the profile's own permissions). The app's shell (`app/src`) and Obeya's scripts read it
from there and send it as `X-Obeya-Key`; the page and the panel carry it in an `HttpOnly;
SameSite=Strict` cookie `obeya-<port>` (a browser keeps cookies per host, not per port: a scratch
Obeya beside the owner's has a cookie of its own). Without it the API answers 401 `notOwner` (the
page then reloads), the page and the panel are „Dieser Browser ist nicht bei Obeya angemeldet“ with
how to sign in (401), and a WebSocket opens not at all. A page a link from another site opens comes
without the cookie, which is `SameSite=Strict`: it gets a page that opens the same address again,
now from Obeya's own page, with the cookie.

A browser gets the cookie from a link, as Jupyter's: `/login?token=…` (with `&next=` a path of
Obeya's to open, nothing else) sets it and goes on from a page of its own, not with a redirect: a
link opened from another app or site (the app's shell navigates its window from its own `tauri:`
page) starts a cross-site navigation, whose redirects carry no `SameSite=Strict` cookie. The token
is made at every start of the server and signs in any number of browsers (Chrome beside Safari)
until the server stops; a link from before a restart says that it no longer holds. Who holds the
key gets the link (`POST /api/login-link`, only on this machine):

- Obeya prints it when it starts („Obeya … on http://127.0.0.1:4417/login?token=…“), at every
  restart anew.
- A second start of Obeya while one runs says where it runs and prints the link to it.
- The app's window and its panel sign in through it at every start. „Im Browser öffnen“ (the File
  menu on a Mac, the configuration) opens the page in the default browser through a link with a
  token of its own (`once`), which signs in that one browser: it goes through the system's `open`,
  whose command line other accounts on the machine see in the process list.
- `scripts/scratch-obeya.ts` prints it as `url`, and `--login <port>` again.

Once signed in, the address alone (a bookmark, `http://127.0.0.1:4417/`) opens Obeya: the cookie
holds as long as the key (400 days at most, the longest a browser keeps one). Workers hold no key:
their narration goes to a server of its own that answers narration clips and nothing else
(`serveNarration`, their `OBEYA_URL`).

*The workers' files.* A GET of an HTML artifact's files or an answer's passes the site check from
another origin: their sandboxed frame has the origin `null`, so the browser sends what its page
loads (its stylesheet, its images, its scripts) as cross-site, and without the cookie. The frame's
own page comes with the cookie (the canvas loads it) and is sent on to an address with a key of its
directory (`…/demo/~<key>/index.html`, keyed with a secret made at every start), so what it loads
beside itself carries that key, which only a request with the owner's key (or a paired device's)
gets to see; an address with it needs nothing more. Then the gate of other devices (below) has its
say.

The cookie is sent to any server on `127.0.0.1` the browser opens, whatever its port: a page the
owner opens there from another account on the machine would see it.

#### Other devices

The owner's phone reaches Obeya over the owner's own private network (`src/server/remote.ts`,
`src/server/tailscale.ts`, `src/ui/access.tsx`); Obeya runs no service of its own for it and goes
onto no open internet. The setting „Von anderen Geräten erreichbar“ (`remote` in `settings.json`)
is off by default, and off Obeya answers only on this machine. On, it is one of two:

- *Über Tailscale*: Obeya keeps listening on `127.0.0.1` and runs `tailscale serve --bg
  --https=<port> http://127.0.0.1:<its port>`, which proxies HTTPS and WebSockets from
  `https://<machine>.<tailnet>.ts.net`, the name `tailscale status --json` gives. It takes 443,
  else 8443, else 10000, whichever no entry serves yet, and touches no other entry; the one it made
  it notes in `tailscale-serve.json` in its home, so it moves that entry to a new port of its own
  (the app may pick another) and turning the setting off removes it, and only it, after a restart
  too. Stopping, Obeya removes the entry, so a program that takes its port afterwards is not served
  to the tailnet; it serves again at its next start, at the same address while 443 is free. Bun's
  dev server (`--dev`) answers for the page's scripts and styles only under the name it listens on,
  so through `tailscale serve` an Obeya started with `--dev` shows a blank page.
- *Über eine Adresse*: Obeya also listens on an address of this machine the owner picks from its
  interfaces (another VPN's), with the same routes, in plain HTTP. The section says that a phone's
  browser allows the microphone and push only over HTTPS.

The section „Von anderen Geräten“ of the configuration and „Telefon verbinden“ show the setting the
same way, with what the network lacks, each with its one step: Tailscale missing (how to install it,
per platform), not running, logged out, HTTPS off in the tailnet (a link to the DNS page of the
admin console; `CertDomains` empty in its status), on Linux the operator right `tailscale serve`
needs (`sudo tailscale set --operator=$USER`, recognised by its "Access denied"), all three ports
taken. With Tailscale ready they name the account it is logged in as, which the phone logs in with
too, and while the tailnet has no other device (no `Peer` in its status) they say that the phone
is not in it yet and cannot find the address (it gets NXDOMAIN): install Tailscale on the phone and
log in as that account. They look at Tailscale again every few seconds while open, so logging in,
turning HTTPS on or the phone joining the tailnet shows (and serves Obeya) without a click. The section also says that other devices reach Obeya
only while it runs here.

A request is *local* when it comes from loopback under one of this machine's names and no proxy
forwarded it (no `X-Forwarded-For`, `-Host`, `Forwarded`); through `tailscale serve` requests come
from `127.0.0.1` too, but under the tailnet name and forwarded, and count as remote, as does
anything on the other address. A remote request needs a paired device; without one the page is
„Dieses Gerät ist nicht mit Obeya verbunden“ with how to connect and a field for the code (401),
the API answers 401 `notPaired`, and a WebSocket opens not at all.

*Pairing.* The section's button „Telefon verbinden“, below the paired devices (shown while other
devices reach Obeya), opens a dialog of that name: a QR code of `<address>/pair?code=<code>` beside the address and the code in large digits. The code
has six digits, holds five minutes (a new one comes when it ran out with the dialog open) and pairs
one device; five wrong tries spend it (only those from Obeya's own page or without `Sec-Fetch-Site:
cross-site`, so another site cannot spend them by sending a browser in the tailnet to `/pair`). The phone opens the address (the camera reads the code), and
the server sets the device cookie `obeya-device` (32 random bytes; the database keeps only its
SHA-256 with a name from the user agent, „iPhone · Safari“, and when it was paired and last seen)
and sends it to the canvas; the dialog then says „iPhone · Safari ist verbunden.“. The cookie is
`HttpOnly`; over HTTPS `Secure; SameSite=None`, and the origin check keeps other sites out as on
this machine; over HTTP `SameSite=Lax`. Either way an HTML artifact's own files load through the
keyed address (above).

*Devices.* The section lists them with when they were paired and last seen, each with „Entfernen“,
which takes effect at once and has no undo (pairing again is quick): its cookie lets nothing in,
and its open pages lose their WebSocket and reload to the page that says how to connect. A device
stays paired until it is removed or has gone unused for 90 days (a phone given away or lost and
forgotten); the cookie itself lives 400 days, the longest browsers keep one. Pairing, the devices
and the setting are managed only on this machine (`/api/access…` answers another device 403
`onlyHere`, and the section shows it only its heading and hint): a phone that is lost cannot pair others or keep
itself in.

*Keeping the machine awake* (`src/server/awake.ts`). While the setting is on, Obeya keeps the
machine it runs on from idle sleep, as the switch „Rechner wach halten“ beside it says: *Solange ein
Agent arbeitet* (the default), while a worker is in a turn (or its ended turn waits for its
background work, or its work is landing), letting go two minutes after the last one ended (the next
turn often follows soon); or *Immer*, the whole time Obeya runs, so the phone can give it a task
while no agent works (`awake: "always"` in `remote`). It looks every five seconds. Per platform:
`caffeinate -i -w <pid>` on macOS (`pmset -g assertions` shows it, "on behalf of" Obeya's process),
`systemd-inhibit --what=idle:sleep --who=Obeya` around `tail --pid=<pid>` on Linux
(`systemd-inhibit --list`), both ending by themselves when Obeya does;
`SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` through `bun:ffi` on Windows
(`powercfg /requests` as an admin; without admin rights `CallNtPowerInformation(SystemExecutionState)`
shows `ES_SYSTEM_REQUIRED`), which holds as long as the process. The display may still sleep.
Otherwise the machine sleeps as it is set to, and a phone no longer reaches Obeya until it wakes; a
closed laptop lid puts it to sleep either way, which the switch's hint says. Workers on SSH hosts
keep the machine Obeya runs on awake too (Obeya drives them from there), but their hosts keep their own power settings.

#### The phone view

On a phone the page shows the phone view instead of the canvas (`src/ui/phone.tsx`): at the same
address, from the same bundle. A phone is a device whose pointer is coarse and whose screen's
shorter side is under 600 px, whichever way it is held; a tablet and a narrow window at the desk
keep the canvas. `?view=phone` or `?view=canvas` in the address decides instead (to try the view at
the desk). The rule is settled when the page loads; turning the phone does not switch views.

It holds one WebSocket per canvas (the canvas's own `/ws`, so the server sends it what it sends a
canvas page, nothing new), and shows, under the sign and the word Obeya:

- **„Für dich“**: what waits for the owner across every canvas (`needsYou`), canvas by canvas in the
  switcher's order and within a canvas in Tab's order, then „Obeya hat geantwortet“ where an
  answer waits unread there. Each card says what it waits for (its state line: „Demo bereit“,
  „Frage an dich“, „Vorschlag eines Agenten“ …) and since when. Since when a card waits the server
  notes when `needsYou` turns true for it (`waiting_since` on the card, kept across restarts while it
  waits, `waitingSince` in the snapshot). Cards the owner snoozed while they waited stand at the
  end, until they come back (see Snoozing a card).
- **„Läuft“**: the cards an agent or Obeya is at and that wait for nobody (working, taking in the
  owner's words on its handover, finishing, landing or just approved, in the queue, in a PR, an
  idea's or a Question card's agent thinking; `runs` in `src/ui/talk.ts`), with their status line;
  snoozed ones at the end. Every card that leaves „Für dich“ without being done stands here: until
  2026-10-17 a handed-over card whose worker took in a note of the owner's stood in neither list
  until it handed over again.

Both lists show the cards as the canvas does, as wide as the screen (`CardFace` and `cardClass` in
`src/ui/parts.tsx`, shared with the canvas): the state's colour as a rule across the top and in the
state line at the bottom, an idea on its rose stock, the owner's turn framed in orange, the kind
line (with several canvases after the canvas's name), the title in the serif and the line of text
the canvas shows (the question, the status line). Only the pin is left out: everything in „Für
dich“ waits for the owner. Held upright the cards stand one below the other; where the screen is
wide enough for two of at least 340 px (the phone turned) they stand side by side, each row as high
as its taller card, the state lines at the bottom. Before (until 2026-10-17) a row was a white box with a thin coloured
strip at its left edge, and on the phone the idea's red and the owner's turn's orange could hardly be
told apart there.

Obeya's conversation is not on the list but a panel of its own over it: the button for it left of the
microphone, in reach of the thumb, opens it, and so does the card „Obeya hat geantwortet“. The button
is the canvas's (the speech bubble, with the number of answers waiting unread, across the canvases),
at a finger's size, and inverted while the panel is open. It comes up from below and fills the screen: the
conversation with the field under it, the sheet's own (`KoordinatorTalk`), and below the field the
room of the microphone, so the microphone never stands over the field. Whose Obeya it is (when there
are several canvases) a picker right of the microphone says, on the list as in the panel, since it
also decides whom the microphone speaks to with no card open: the canvas's name, which opens the
phone's own list of them; with one canvas there is none, and with a card open neither (the microphone
speaks to its agent then). The button opens the conversation an answer waits unread in when the
one picked has none, and the picker follows. The conversation is the only thing in it that scrolls: as a box in
the scrolling list (until 2026-10-16) it was a scroll area inside another, and the list scrolled on
past the field to make room for the microphone. The panel takes the part of the screen the keyboard
leaves, so the field stands right above the keyboard: the phone view asks the browser to make the
page shorter while the keyboard is up (`interactive-widget=resizes-content`, which Chrome on Android
heeds), and follows the visual viewport where it does not (Safari). Until 2026-10-17 the visual
viewport alone decided, and Chrome reports it wrong by its own bars: where it draws the page under
the gesture bar the field ended behind the keyboard by that bar's height, and with a toolbar at the
bottom it ended far above it. Its top is a grip the owner drags up and down to the height they want:
the panel follows the finger and stays where it is let go, the page under it scrolling on until all
of it can stand above the panel. Let go within 15 % of the screen's top it takes the full height,
within 15 % of its bottom it closes (`settle` in `src/ui/panelHeight.ts`). Let go while the finger
still moves, it is thrown: it glides on in that direction and slows down evenly until it stops
(`thrown`, `glide`), so a short swipe up gives the full height and one down closes it, and a gentle
push carries it a little further; a finger that stood still for 50 ms before lifting leaves it where
it is. Until 2026-10-17 it only
closed or sprang back: let go further than 110 px down (or flicked) it closed, so a full panel could
not be dragged to the middle. It opens at the full height (beside a demo video at half, below). The same button left of the microphone, Back and Esc close it
too, and its address is
`?talk`, as a card's is `?card=<id>`. Its unread answers count as read once it is open, not when the
page opens. A card opened from the conversation opens over it, and Back returns to it.

The lines above the microphone (Obeya's reply, a confirmation with „Rückgängig“, a command still
being read) are swiped aside, to either side, to be rid of them before they go by themselves, on the
list as on an open card: pulled past a third of their width or flicked, they fly out; less, they
spring back, and a drag up or down leaves them (`Aside` in `src/ui/aside.tsx`). A line swiped away
takes nothing back: a command's „Rückgängig“ goes with it unused, and a command still being read is
carried out, its confirmation not shown. Until the owner has swiped one away in this browser, each
line nudges aside and back once after it appears. The canvas has no such gesture: it was wanted on
the phone only.

A tap opens a card full screen: Back (the button, the browser's back, Esc) returns to the list where
it was scrolled. The card's address is `?card=<id>`, so a reload or a restart opens it again. It is
the canvas's detail view (`Detail`) with the same answer options, demo, approve buttons and undo;
a demo video plays full width, and full screen from Obeya's button on it (see below). The page holds what the card
is about (title, text or brief, demo) and the decisions, and is the only thing on it that scrolls.
The card's conversation is not on it but in the same panel as Obeya's, with the same grip, Back and
Esc, keyboard handling and confirmations above the field: the button left of the microphone opens
it, with a number for what waits there (the messages since the owner last had the conversation open
or last wrote there, plus the questions open). Only the messages the conversation shows count, not
the agent's words between its steps that fold under them (`unseen` in `src/ui/talk.ts`, over
`cardTalk`, the conversation as the card shows it); until 2026-10-17 those counted too, and a card
with two handovers showed 81, and its address is `?card=<id>&talk`. Every card kind
gets there the same way: the talk column of `Split` (and the Question card's conversation) goes into
the panel through a context the phone view provides (`TalkElsewhere` in `src/ui/detail.tsx`, a React
portal), so the canvas is untouched and no card kind has code of its own for it. A card at work
(`working`) and one that waits for answers to its questions (with options to pick or without) open
with the panel up (`opensWithTalk` in `src/ui/talk.ts`): what its agent says, or what it asks, is
what the owner opened it for; otherwise the page shows first. Until 2026-10-17 a working card opened
on its page too, and the owner missed its conversation there; until 2026-10-19 so did a card whose
question had no options, its „Frage an dich“ on the page and the question behind the button. On a working card the panel is a half sheet, as
beside a demo video (below), so the title, state line and buttons stay in view above what its agent
says. While the conversation shows an agent at work (`agentWorks`, or Obeya reading the owner's
words on the card; for Obeya's own conversation, Obeya reading or looking a question up,
`obeyaWorks`), the button carries the moving line of a working card along its foot, so the work is
seen with the panel closed too. The conversation opens at the first message the owner has not seen (as
the button counts them: after the last one they saw and after their own last words), at the top of
the panel as far as it scrolls, so with nothing new it opens at its end; the new messages carry the
orange edge they have on the desktop (The conversation). Until 2026-10-17 a half
panel opened scrolled near the conversation's start: the scroll to the end, made while the panel
still rose, was taken for the owner scrolling up (`useStickToEnd` now knows its own scrolls). Beside a demo video the panel is a half sheet and the page scrolls the video into the upper
half, so a comment at a place in the video („Hier kommentieren“ brings the panel up with the cursor
in the field) is written while the video stays in view, with the place's chip and the pause on typing
as on the canvas; its grip sets another height, as on Obeya's. Turned sideways the panel opens at
the full height there too. Until 2026-10-17 the conversation stood on the page below the card's columns, a box
capped at 62 % of the screen's height: a scroll area inside another, where the finger decided which
of the two scrolled, and the page scrolled on past the field to make room for the microphone. Plan docs are not read there and the configuration is not opened from there:
the links to them do not show. Every call goes to the API of the canvas in view (the open card's,
else Obeya's), and the list is not on the page while a card is open, so nothing in it loads from
another canvas's API. A call about a card, and words about it, go to the API of the card's canvas
(`cardAt`), whichever canvas is in view as they go out: closing a card puts Obeya's canvas in view
before the card's last calls go, and until 2026-10-18 the release of the comments held back on its
demo went to that canvas, which knew no such card, whenever it was another; they waited the ten
minutes then.

The microphone at the bottom is held by a finger (pointer events, no long-press menu, no text
selected; lifting the finger or the browser taking the gesture ends the recording) and speaks to the
open card's agent, else to Obeya. No line under it names whom it speaks to (until 2026-10-17 the
canvas's „→ Agent · …“ stood there): what is in view fills the screen, so that goes without saying,
and the 33 px it took go to the list and the conversation; the line still says when the microphone
hears only silence. Nor does „→ ins Feld“ show under it with the cursor in a field: the line lifted
the microphone onto the field above it. While the keyboard is up it hides, and so do the button for
Obeya's conversation and the canvas picker: the field has its own microphone. The keyboard counts as
up while a text field has the focus and the page's height is more than 150 px below the tallest it
had at that width (`ph-kb` on the page's root); the keyboard closed with the phone's own button
leaves the focus in the field, and until 2026-10-17, when the focus alone decided, the microphone
stayed hidden then. Shown again with the cursor still in the field, it dictates into the field. The
field's microphone is held by a finger as the one at the bottom is, and the touch on either is
nothing but the press (its `touchstart` is cancelled): held half a second, Chrome took it for a long
press on the field's frame and began selecting text, which closed the keyboard and cancelled the
touch, so the recording ended at once. A tap on the field's screenshot button leaves the cursor in
the field, so the keyboard stays up and the field does not move away under the finger (before, the
tap only closed the keyboard and the picker needed a second one), and back from the picker the field
takes the focus anew, which brings the keyboard up again. A tap on Send leaves the cursor in the
field the same way and sends at once, and the keyboard stays up for the next message (until
2026-10-17 the first tap only closed the keyboard and the second sent). A tap into a text field
while the keyboard is down only puts the cursor where the finger was and brings the keyboard up
(`tapOpensKeyboard` in `src/ui/phone.tsx`); with the keyboard up the tap is Chrome's again, and on a
word marked misspelled it opens the suggestions above the keyboard. Until 2026-10-18 Chrome took
that first tap too: on such a word its suggestions opened, and on the owner's phone they closed the
keyboard that had just begun to open. The texts that name the space bar name the microphone
there (`forTouch`). Enter breaks the line in a field there, and only Send sends
(`enterBreaksLines` in `src/ui/composer.tsx`): the keyboard's Enter key is where a phone types a
line break, and a message sent half written cannot be taken back; the line under a dictating field
leaves out „abschicken mit Enter“. A field's screenshot button offers the photo library and the camera
(`accept="image/*"`), and marking a screenshot works with a finger. Drafts are kept per tab under a
name of the phone view's own (`obeya-drafts-@phone`), with the field under Obeya's conversation one
per canvas (`obeya:<canvas>`).

Turned sideways (landscape, the screen under 600 px high) the phone has about 400 px of height, of
which the bar at the top, the microphone at the bottom and the fade under it took almost half, the
microphone standing over the middle of the two columns of cards. There the microphone stands at the
right edge, halfway up, where the thumb holds the phone, in a strip of its own beside
the content, so it covers no card; the line under it naming whom it speaks to wraps in that strip,
and the screenshot button stands above it. What stands beside the microphone held upright moves into
the strip too: the canvas picker to its top, the button for Obeya's conversation to its bottom. The
fade goes, the bar is slimmer, and on the list it scrolls away with the sign (on an open card it
stays, with Back; on the panel, as its grip). The panel leaves no room under its field, the
microphone standing beside it, and while the keyboard is up the field takes the strip's width too.
Confirmations stand at the bottom of the content, in the panel above the field. Held upright nothing
changes.

A demo video goes full screen from the button at its top right (`useFullscreen` in
`src/ui/fullscreen.ts`), not from its own controls: their full screen button is hidden
(`controlsList="nofullscreen"`). Full screen holds the screen in the video's orientation (landscape
for a demo), however the phone is held when it starts. Once the phone has been turned to match,
turning it back ends full screen (held the other way for 300 ms, read from the device's orientation
sensor, which goes on while the screen is held), as do the button and Back. Turning the phone into
landscape while the video plays and stands in view starts full screen too. Chrome on Android did all
this itself for a video in full screen from its own controls, but racily: once the phone matched the
video it released the screen, which right then could still report the orientation from before, so
turning the phone into landscape sometimes ended full screen and turning it back sometimes started
it. Obeya holds the screen until full screen ends instead, so the screen and full screen never
disagree. A browser that puts only the video itself into full screen (Safari on an iPhone) has no
such button and keeps the video's own controls, whose player turns with the phone.

Each time full screen starts, Chrome on Android shows its notice at the bottom („<origin> – zum
Beenden des Vollbildmodus: von oben ziehen …“). It is a security notice that no page can turn off.
Only skipping the browser's full screen would avoid it: the player would then cover the page, with
Chrome's address bar or the status bar still showing, and could no longer hold the screen in the
video's orientation, since Chrome locks the orientation only in full screen (or in a web app whose
manifest says `fullscreen`). The owner kept real full screen with the notice (2026-10-17).

When the server does not answer for 3 s (a phone back from its lock screen reconnects within that),
a line at the top says „Obeya antwortet nicht · seit 14:02“ and why that may be; the page connects
again by itself, at once when it comes back into view rather than after the pause it waits. The 3 s
count from that moment: a phone that was locked lost its connection meanwhile, which says nothing of
the server, so the line does not show while the page reconnects, and a connection still opening
from before is tried anew. A sleeping machine answers nothing at all, not even a refusal: a
connection that has not opened within 3 s counts as not answering, and one not open after 10 s is
tried anew.

#### Notifications on the phone

Obeya tells the owner's phone when something starts to wait for them (`src/server/push.ts`), by Web
Push to the browser's own push service (Apple's, Google's, Mozilla's): no account and no service of
Obeya's. A message is encrypted for the device (RFC 8291) and the request signed with Obeya's VAPID
key (RFC 8292), both with WebCrypto (`src/server/webpush.ts`); the push service sees neither title
nor text. The key is made at the first start and kept in `vapid.json` in Obeya's home (readable by
the owner alone), as every subscription holds its public half.

*Turning them on.* A paired device holds at most one subscription (`push` on its row in `devices`);
removing the device removes it, and one its push service answers with 404 or 410 goes. On an iPhone
a page gets pushes only from the home screen (iOS 16.4 and later): in Safari the phone view says how
(„Teilen“, „Zum Home-Bildschirm“, then open Obeya from there) until it runs that way. There, and in
a phone's Chrome without that step, a box at the top asks „Benachrichtigungen einschalten“; its
button asks for the permission (iOS asks only after a tap) and the box stays until the permission is
given or refused. With it given, the page subscribes with Obeya's key and hands the subscription to
the server (`PUT /api/push`) at every load, so a renewed subscription or a new key reaches it. Over
another VPN's address (plain HTTP) there are no pushes, and nothing says so on the phone: the section
„Von anderen Geräten“ does. The section's device list says which devices have them on.

*What is pushed:* a card whose `needsYou` turns true (a demo or a handover, a question, an agent's
proposal, a PR to merge, an idea's turn), with what it waits for as the text („Demo bereit“, „Frage
an dich“ …) and its title (and its canvas where there are several); a landing that failed (a card that
was landing and needs the owner again: „Landen fehlgeschlagen“); a worker that is stuck (its turn
failed or ended twice without a handover and Obeya made a question of it, `stuck` on the question:
„Agent kommt nicht weiter“). Obeya's answers in its conversation are not pushed: the owner asked from
where they are. Cards waiting already when Obeya starts are not pushed.

*Not while the owner uses Obeya:* nothing is pushed while a page on this machine was in use in the
last three minutes, or while a page on a paired device is in use. A page in use is one in view in
which the owner moved, typed or scrolled, or a video plays, within the last half minute: it says so
every 30 s then (`{ type: 'here' }`), and when it comes back into view. A canvas left in view with
nobody at it holds nothing off. The phone view counts as in use whenever it is in view, as a phone's
screen locks by itself; and a device holds pushes off only until its page goes out of view (locked,
another app in front: `{ type: 'away' }`), closes, or has said nothing for 45 s, without the three
minutes after: a phone put away is where the pushes should reach the owner. What starts waiting while
the owner is there is not pushed later either: it is in front of them.

Every push goes as urgent (`Urgency: high`), which lets the push service wake a sleeping phone. Whether
it does is up to the phone: on the owner's Pixel (2026-10-16) a push sent while it slept showed only
once it was unlocked, as Android held Chrome's messages back.

*Several at once:* the first goes out at once; what starts waiting within the minute after goes out as
one push at its end, without what no longer waits by then („3 Karten warten auf dich“, the titles as
the text), and a further minute starts; a minute without anything ends it.

*Tapping a push* opens its card in the phone view (`/?card=<id>`), one for several „Für dich“: in the
app that is open already (the service worker tells the page), else in a new one. A later push for the
same card replaces the earlier one in the phone's notifications.

*The web app.* The page names its manifest (`src/ui/manifest.webmanifest`, which the page's bundle
carries: standalone, the icons `/icons/180.png` and `/icons/512.png`), and the phone view registers a
service worker at `/sw.js` (`src/ui/sw.ts`, served as the source of its function, so the binary needs
no file for it). The manifest's icons and the worker need no pairing: nothing in them is the owner's.
The worker shows the pushes and keeps the page's shell: the page and its scripts come from the network
and are kept, and when the network fails or takes more than 3 s, from what was kept. So the app opened
from the home screen while the machine sleeps shows the phone view saying that Obeya does not answer,
within about 7 s, instead of the browser's error or a blank page that waits: the page waits 3 s for
its language and the canvases, then goes on with the browser's language and the canvases it last
had (their cards come once Obeya answers). The worker asks for the page anew, as a request of its
own: passed on, the request of the app opened from the home screen (a launch Android's Chrome marks
`Sec-Fetch-Site: cross-site`, as a link from elsewhere) keeps that mark but loses `Sec-Fetch-Mode:
navigate`, and *Its own site* would refuse it. The canvas page at the machine registers no worker.

### Setup assistant

One list of what Obeya needs on this machine (`src/server/machine.ts`, `src/ui/setup.tsx`), in four
parts:

- *Agenten* (needed: Claude Code, its login, git, and git's name and e-mail, without which an
  agent's commit fails);
- *Pull Requests* (gh and its login: work in a repository on GitHub lands through pull requests, so
  it is needed at its first approval, not before);
- *Sprachbefehle* and *Demos* (the checks the configuration dialog makes, voice-setup.ts and the
  demo skill's setup.ts, each with the size still to download; what both need shows once; uv stands
  above the speech recognition, whose "Installieren" waits until uv is there and says so; the
  recognition's line also says how fast it is here and offers a cloud service, see The Spracheingabe
  settings).

The checkout's agents run on the Agent SDK's own Claude Code, so there it is always there; the
compiled binary's run on the machine's, and the list says which version Obeya was checked with (the
SDK's) when the machine's differs. Logins are read from `claude auth status` and `gh auth status`.

"Installieren" installs what needs no admin rights: Claude Code and uv with their official
installers (`curl … | sh`, PowerShell's `irm … | iex` on Windows), the speech recognition through
the voice's installation, a demo's voice; system software (git, gh, ffmpeg, Node, a browser) comes
with the command for this platform and a copy button, and is installed at a click where that needs
no password (Homebrew where it is there, winget). A login opens a terminal with `claude auth login`
or `gh auth login` (Terminal through `osascript` on a Mac, `cmd` on Windows, the first terminal
found on Linux; none found: the command to run by hand); git's name and e-mail are typed into two
fields. The list checks again when the window gets the focus back.

Obeya puts `~/.local/bin` (the official installers') and on a Mac Homebrew's directories on its
`PATH` at start, so what was installed is found from a process the desktop started; on Windows every
check (the assistant's, the voice's and the demos' in the settings) first reads the user's and the
machine's `PATH` from the registry again (`src/server/path.ts`), so what was installed meanwhile, by
Obeya or by hand, turns "ok" once the window gets the focus back.

#### The first canvas

On the first start the page ends with the first canvas, under "Wo liegt dein Projekt?": two cards
with a radio button each, "Schon auf diesem Rechner" and "Auf GitHub / einem Server", with the
fields of the one chosen below: a repository's folder (a path, or the system's folder dialog where
there is one: `osascript`, PowerShell's, zenity or kdialog) or a clone (`owner/name` through `gh
repo clone` where gh is logged in, else from GitHub by its URL; any git URL; into the home directory
unless another is given). Below a folder's path it shows the main branch Obeya found there (`POST
/api/setup/folder`), and after a clone the clone's, beside "Gespeichert". A folder without git gets
the offer to set it up there instead (see Setting up git in a folder), whose confirmation also
creates the canvas.

Obeya writes `canvases.json` with it (worktrees, as Obeya's defaults have it; two clones when the
repository's settings say clones), starts the canvas at once (see Live
configuration) and the page opens it, on which a first card says what to try (the marker `welcome`
in Obeya's home, read once when the canvas runs). Later the Konfiguration dialog opens the same list
over the canvas ("Einrichtung prüfen"), without the first canvas. A scratch Obeya with `"setup":
true` in its stage file starts like a first start.

### Setting up git in a folder

Where the first canvas or "+ Repository" in the configuration is given a folder in which git finds
no repository, it offers two ways on, each with a line on what it means (one component, `GitSetup`
in `src/ui/setup.tsx`): „Ohne git verwenden“ (the folder stays without git, `"git": false` in its
entry; see Folders without git), and „Hier ein git-Repository einrichten“ (`src/server/git-setup.ts`). It first shows what the first commit would hold
(`POST /api/setup/git-preview`): the folder's own entries with their files counted and their sizes,
files from 1 MB on listed apart as large, what stays out, and the default `.gitignore` (build
output, dependencies, secrets: `node_modules/`, `dist/`, `.env*` but `.env.example`, keys) that
Obeya writes where the folder has none. The preview is computed against a git directory of its own
in the temp directory, so looking changes nothing; the owner keeps more out with a `.gitignore` of
their own and "Neu ansehen". Confirming (`POST /api/setup/git`) runs `git init` on git's
`init.defaultBranch`, else `main`, and commits every file not ignored, since workers only see
committed files, under the name and e-mail of the assistant's step for them (none: it says so and
does nothing). A step that fails undoes what came before, so the folder is as it was.

### Self-update

Obeya runs from a checkout that work lands on, so `live` must mean running (the compiled binary has
no checkout and never restarts for new code). Without `--dev` the `obeya` process supervises the
server: when the checkout its code comes from moves to commits that change code (not only docs:
`docs/`, any `.md`, the site for obeya.si in `site/`, or the workflows in `.github/`), the server
stops and starts again; when the commits since it started change `package.json` or `bun.lock`, it
runs `bun install --frozen-lockfile` in the checkout first (a failure goes to the log and the
restart goes ahead, the new code then fails where it imports what is missing); workers resume, and
an open page reloads when it reconnects to a new server process.

#### Waiting for the workers

The restart waits until no worker is in the middle of a turn or waiting for its background work,
even one that has asked or handed over meanwhile (at most 15 minutes), since it stops whatever a
worker runs. The workers it waits for are told it is due: they start nothing long, stop background
work they can start again, and pause at the next safe point by ending their turn (no nudge, no
question to the owner; the card's log says it paused).

A worker whose turn a message starts before the restart (a card started, an answer, an approval
whose work did not land for a conflict) hears that the turn keeps Obeya waiting: it takes the
message in, leaves the work it asks for until Obeya resumes it, and ends the turn at once (the
card's log says so). Background work a worker lets finish wakes it for a turn before the restart,
and so does a message; such a turn hears once that Obeya still waits and that it holds the restart
up (with its first tool step, or with the message; the card's log says so), and the worker ends it
again. A resumed worker hears that what ran was stopped (exit code 137) and goes on. A worker that
waits for the restart to finish its landed work is not in a turn and does not hold it up.

#### Waiting for the owner

The restart also waits while the owner watches a demo video or dictates in an open page (from the
press until the words are in the field or Obeya has read them), past the 15 minutes too: the page
tells the server over its WebSocket whenever that starts or stops, and a page that closes lets go.
The server also holds it off itself while it answers a recording (`/voice`), whether or not the page
still does. A command in its undo window holds the restart off on the server's own count, whether or
not the page that said it is still open, and until it has run.

While a restart waits, the bar shows it ("Neustart wartet auf N Agenten", "… auf dein Video", "… auf
dein Diktat"; until when at most, while only agents hold it); hovering names why and the cards it
waits for, on this canvas and under each other canvas's name (the server gives their titles, as the
page knows only its own cards), and "Jetzt neu starten" (`POST /api/restart`) has it go ahead at once, its hover text
saying what that cuts off.

#### Keeping the page

The page that reloads keeps what was open: just before the reload it writes down (per tab, in
`sessionStorage`) the open card, project (its plan doc read or not) and sheet, the scroll position
of every scrolled box in them, the drafts in their text fields and where the demo video stood (it
plays on only in a tab in sight); the new page opens them again without flights or unfold and puts
positions and drafts back while their content loads (`src/ui/keep.ts`). The camera is kept anyway.

#### Pulling from the upstream

Obeya from a clone of its repository (README: From source) moves only when its owner pulls. So the
supervised server fetches the upstream of the branch its checkout is on (`origin/main`, as a rule) at
the start and every hour (`src/server/source-update.ts`; only that branch into its remote-tracking
ref, no `FETCH_HEAD`, as the Lesestand does; a fetch that fails goes to the log and is tried again
next hour). While the upstream has commits the checkout lacks and they change code (the same test as
for the restart: docs alone do not count), the bar shows them beside where the app shows its
updates: "Update: 12 neue Commits", their subjects and dates on hover (the newest ten), and a
"git pull" button. The click fetches once more and fast-forwards the checkout to the upstream (`git
merge --ff-only`); the restart for new code follows as after a landing, waiting for the workers and
the owner, and the bar shows that wait instead. Where Obeya cannot fast-forward, there is no button
and the hover says why and what to do: the checkout has commits of its own (a contributor's), or
uncommitted changes to files the new commits change (named). Whatever else git refuses (an untracked
file in the way, say) stays on the hover with git's message until a pull goes through. When the
owner comes back to the page (from the terminal, where they committed what stood in the way), Obeya
looks again without fetching.

A branch without upstream (a card's, in a worktree) or a detached HEAD has nothing to pull, and
neither has an Obeya with `--dev` (it does not restart for new code) or the app and the compiled
binary (no checkout; the app has its own updates). The owner's Obeya here runs from the checkout work
lands on, which is ahead of `origin` rather than behind, and shows it only when `main` was pushed
from elsewhere.

### Stopping

Ctrl-C, SIGTERM or `POST /api/stop` (the app; Windows has no SIGTERM), with or without `--dev`,
stops Obeya the way a restart goes, only nothing starts again: the workers in the middle of a turn
are told Obeya is about to stop and pause at a safe point, and Obeya ends once none is (at most 15
minutes). The bar shows it ("Beenden wartet auf N Agenten", "Jetzt beenden"), and a second Ctrl-C
ends it at once (the terminal's Ctrl-C reaches supervisor and server, and the supervisor passes it
on: signals within a second count as one press). A stop does not wait for the owner's video or
dictation, since the owner asked for it; it turns a restart that waits into a stop. The next start
resumes the workers it stopped like a restart does.

The sidecars (transcription, speech, narration voice) run in a process group of their own, so the
terminal's Ctrl-C does not reach them: they keep working while Obeya waits, and Obeya ends them once
it stops by ending their stdin, which they finish as a normal end after the request they are on
(Obeya gone by the time they answer it, they end quietly); one still there after 30 s is killed. On
Windows, where a detached process would open a console window for every program it starts, the
Python sidecars ignore Ctrl-C instead.

So do the agents' Claude Code processes on this machine, the `ssh` that runs a session or a forward
on another, and the process that keeps the machine awake: in the terminal's group, Ctrl-C reached
every agent in the middle of its turn, which broke off at once (the CLI's `[ede_diagnostic]`
error), and with all of them idle Obeya ended within a second instead of waiting for them to pause.
Out of that group, they hear of the stop from Obeya and pause at a safe point, and the commands they
run go on meanwhile. When Obeya ends (they paused, the second Ctrl-C, the 15 minutes passed), it
sends SIGTERM to each agent's process group, so no agent goes on with a turn nobody hears and what it
ran goes with it. On Windows the agents stay in the console and a Ctrl-C there still reaches them
(Obeya ends them as before, by ending their stdin);
a stop through `POST /api/stop` (the app) waits for them all the same.

### Decisions

- **The machine stays awake while a worker works, or always where the owner switches it so**
  (2026-10-16, the owner). Keeping it awake the whole time other devices may reach Obeya would be
  too much as a default (a laptop on battery), but the owner wants to give Obeya tasks from the
  phone while no agent works; a hint how to keep the machine awake by hand, per platform, was the
  other way, and a switch does it without leaving Obeya.
- **Other devices over the owner's private network, paired by a QR code** (2026-10-16, from the
  plan „Obeya from the phone“): a public tunnel puts agents with shell rights on the open internet,
  a relay of Obeya's own is a cloud service, and a messenger bot passes everything through a third
  party and holds only a chat. A paired device stays paired until removed or
  unused for 90 days, rather than for a fixed time: a phone in daily use should not have to pair
  again, and one forgotten drops by itself. Managing devices only on the machine itself, so a lost
  phone cannot keep itself in. The cookie is `SameSite=None` over HTTPS rather than `Strict`, which
  the plan said: with `Strict` a worker's HTML artifact on the phone could not load its own files.
- **Pushes by Web Push to the web app on the home screen** (2026-10-16, from the plan „Obeya from the
  phone“): ntfy or a messenger would put a third party between Obeya and the phone and do nothing Web
  Push does not; a native app nothing a home-screen web app cannot do here. Encrypted and signed with
  WebCrypto rather than a library: the two RFCs are a few dozen lines, checked against RFC 8291's own
  example. The owner counts as at the machine while a page there is in use, not merely in view, which
  the plan said: a canvas left in view would otherwise hold every push off until the screen locks.
- **Nor while the owner uses Obeya on the phone** (2026-10-17): the pushes added nothing while the
  owner was working through the cards on the phone anyway. Before, only a page at the machine held
  them off. The phone's hold ends the moment its page goes out of view rather than three minutes
  later, so a push for what starts waiting right after the phone is locked still comes.
- **„Telefon verbinden“ only in the configuration** (2026-10-16): a phone is connected once, and
  again only for a new phone or a closed tab, so it takes no place in the bar. Before, a phone icon
  stood in the bar beside „Konfiguration“.
- **The phone view is a view of its own in the same page, not the canvas made touch-capable**
  (2026-10-16, from the plan „Obeya from the phone“): readable card sizes on 390 px mean mostly
  panning. It shows at the same address on a coarse pointer with a short side under 600 px rather
  than on a narrow window, so a narrow window at the desk keeps its canvas. It reuses the canvas's
  detail view, conversation, drafts and confirmations rather than phone copies of them. One
  WebSocket per canvas rather than one stream for all: the server's canvas messages stay as they
  are, and an owner has a handful of canvases.
- **Obeya restarts itself for new code on its own checkout instead of hot reloading**: a restart is
  a path that already exists (workers resume by session id), hot reloading keeps old state alive
  next to new code. It also restarts for commits made outside Obeya.
- **A due restart is announced to the workers, which pause for it themselves**, rather than waiting
  for a moment in which none is busy (2026-10-01): with six workers in parallel such a moment rarely
  came, and the 15 minutes ran out in the middle of test runs and demo renders (four of the restarts
  after the waiting rule came in). An agent knows where its work can stop; a lock it sets before
  long commands would hold restarts off just as well but rests on every agent remembering it, and
  restarting each worker on its own between steps is impossible with one server process.
- **A turn started just before a restart is kept short** (2026-10-14). Until then such a turn heard
  the notice for a worker in the middle of a step ("finish the step you are in"): a worker sent back
  to resolve a conflict after an approval judged the rebase short, resolved it, handed over and had
  the work land before it paused. Until then too a turn woken by background work heard nothing: a
  worker woken by the render it had paused beside went on from there, checking frames and starting
  the next render, and kept the restart waiting all the while.
- **A restart waits for what the owner does in the page only where a restart would destroy it**
  (2026-10-02): a demo video that plays, a dictation until its command can no longer be taken back.
  Everything else (an open card, a sheet scrolled halfway, a draft) is kept across the reload
  instead of holding the restart off, so new code is not held back by a page that is merely open.
  Until 2026-10-14 a dictation into a field let go when the owner let go of the key: a restart that
  waited for it went ahead while Whisper wrote, and the words of a long dictation were lost. Until
  2026-10-12 the page held a command's undo window: a page that reloaded in the window (the language
  changed in the settings) let go, the restart went ahead, and the confirmed command was lost with
  the server's memory.
- **Sidecars end through their stdin.** Killed instead, Python left the semaphore of the model
  download's progress bar behind and its resource tracker warned about it on the terminal (until
  2026-10-12); until 2026-10-14 the Whisper sidecar left a BrokenPipeError traceback in the log when
  Obeya was gone before it answered.
- **Git is called directly, and test repositories are copied.** Obeya spawns git, a few thousand
  times in a test run: on macOS it calls the binary `xcrun --find git` names, not the `/usr/bin/git`
  shim, which looks it up again on every call (10 ms a call instead of 4). Test repositories are
  copies of a template committed once per set of files (`gitRepo` in `src/server/testing.ts`).
  Together they halved the test suite.
- **A repository's branches are read with one call of git** (2026-10-15): the main branch and its
  commit come from one `for-each-ref` over the local branches and `origin`'s (`readingBranches` in
  `workspaces.ts`), where they took four to seven calls (`symbolic-ref`, `for-each-ref`, `config`,
  two `rev-parse`), read again each time Obeya needs the main branch; a repository starting takes
  whether it has an adapter module from the read that resolved it. A test run spawned 12,600
  processes before, 8,400 now (each a few milliseconds of a run that waits for it).
- **Tests run a file per process** (`bun test --parallel`, the repository's check, 2026-10-15): run
  one after the other, the suite took 165 s on the owner's Mac, waiting most of that time for git;
  in parallel 27 s (Bun 1.4 or later; older Bun ignores the flag; the owner's Mac, CI and the
  builds moved to Bun 1.4.3 for it). The longest file sets how long
  the run takes, so the workers' tests are split by theme (`workers*.test.ts`), sharing their setup
  in `workers-fixture.ts`. That module's bindings are read live; a test replaces one through its
  setter (`setWorkers`), and each file calls `eachTest()`, as files run one after the other in one
  process share the module evaluated once.
- **Every request is checked for its `Host` and `Origin`, from this machine too** (2026-10-16):
  until then a page on any site in the owner's browser could create, start and approve cards with a
  `text/plain` POST to `127.0.0.1`, and a DNS name rebound to it could read and do everything. No
  token in the page is needed beside it: what a foreign page may send without a preflight carries
  its `Origin`, and a preflight gets no CORS headers from Obeya, so nothing follows it.
- **The first canvas is chosen with two cards and radio buttons**: pills read as buttons in a user
  test, not as a choice.
