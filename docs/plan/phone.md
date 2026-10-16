# Obeya from the phone

> Plan doc for reaching Obeya from the owner's phone: what waits and what runs, tasks spoken or
> typed, decisions on cards, and a push when something waits. Deleted when it ships; durable
> content moves into [`docs/design.md`](../design.md).

## Goal

Away from the desk, from the phone, the owner sees what waits for them and what is running, gives
Obeya a task (spoken or typed) and acts on cards as at the desk: answers an agent's questions,
discusses ideas, watches demos and approves, accepts or rejects proposals, sends screenshots from
the phone. And they are told when something waits, instead of having to look.

The phone reaches the owner's own machine over the owner's own private network. Obeya runs no
service of its own, and none of this is macOS-only: it works on Windows and Linux too.

## Where it stands

- The server listens on `127.0.0.1` (`Bun.serve` in `src/server/server.ts`). With „Von anderen
  Geräten erreichbar“ on (W2, `src/server/remote.ts`, design: Other devices), `tailscale serve`
  proxies HTTPS at the tailnet name to it, or it also listens on an address the owner picked; a
  device paired by the QR code of „Telefon verbinden“ (the phone icon in the bar) gets in with its
  cookie, any other remote request gets the page that says how to connect. A device stays paired
  until removed or unused for 90 days.
- Every request and WebSocket upgrade is checked for `Host`, `Origin` and `Sec-Fetch-Site` (W1,
  `src/server/access.ts`, design: Who may talk to it). Before, a POST to `/api/c/<canvas>/cards`
  with `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site` and a `text/plain` body created
  the card, and so did one with `Host: rebound.evil.example` (DNS rebinding); both get 403 and 421
  now. The names it answers to are `LOCAL_HOSTS` there, and the tailnet name or the other address
  while other devices reach Obeya.
- On a phone the page is the phone view (W3, `src/ui/phone.tsx`, design: The phone view): „Für
  dich“ across all canvases with since when each card waits, „Läuft“, Obeya's conversation, a card
  full screen with the canvas's detail view, the microphone held by touch, the machine not
  answering. It holds one WebSocket per canvas.
- A canvas page holds one WebSocket (`/ws`, `src/ui/api.ts`), the phone view one per canvas; each
  tells the server when the page comes back into view (`{ type: 'back' }`, `ownerBack()` in `src/server/canvas.ts`), nothing when
  it goes hidden.
- What waits for the owner is `needsYou` in `src/core/types.ts` (a handover, a question, a proposal,
  a PR ready, an idea's turn, a refused landing given back), counted per canvas with Obeya's unread
  answers by `waitingOn`; Tab visits them by their place on the canvas (`nextAttention`).
- Voice uploads a recording that ffmpeg decodes, so Safari's recordings (MP4/AAC) would work. But
  browsers allow the microphone only on HTTPS or localhost.
- Screenshots are pasted, dropped or picked in a field (`src/ui/shots.tsx`) and scaled down in the
  browser; on a phone the picker offers the photo library and the camera.
- The installed app is a Tauri shell around the server (design: App), which it starts on 4417 or a
  free port and stops when it quits.
- Obeya sends no notifications of any kind.
- While the setting is on and a worker works, the machine stays awake (W5, `src/server/awake.ts`,
  design: Other devices).
- "Remote access from the phone through a relay" was parked on 2026-10-06, together with "no cloud
  service for now" (design: Concepts, Decisions). The private network below needs no service.
- Tailscale is installed on the owner's Mac but logged out.

## Design

### Who may

- **Origin and Host on every request.** Every request and every WebSocket upgrade, from localhost
  too, must name one of Obeya's own hosts in `Host` (`localhost`, `127.0.0.1`, `[::1]`, the
  tailnet name, the address it listens on), else 421 or 403. A request that carries an `Origin`
  must carry Obeya's own (scheme, host and port of the address it was reached at), and one with
  `Sec-Fetch-Site: cross-site` is refused. Requests without either header (the app's shell sending
  `POST /api/stop`, scripts, curl) pass from loopback. The workers' HTML artifacts run in a
  sandboxed frame (origin `null`): what their page loads arrives as cross-site, so a GET of the
  workers' files passes from any origin, and nothing else does.
- **Local or remote.** A request is local when it comes from loopback with a local `Host` and no
  forwarding header. Through `tailscale serve` requests arrive from `127.0.0.1` too, but with the
  tailnet `Host` and `X-Forwarded-For`; they count as remote.
- **Pairing.** A remote request needs a paired device; without one it gets a page that says the
  device is not connected and how to connect it, and no API. „Telefon verbinden“ shows a QR code
  holding the address and a one-time pairing code (valid a few minutes, also shown as text to type
  in). The phone opens it, and the server sets a long-lived device cookie: random, stored hashed in
  the database with a name from the user agent, when it was paired and last seen; `HttpOnly`,
  `SameSite=None; Secure` on HTTPS (so a worker's HTML artifact loads its files on the phone),
  `SameSite=Lax` on HTTP. A device stays paired until removed or unused for 90 days (W2).
- **Devices.** The configuration lists the paired devices with name and last seen, each with
  „Entfernen“, which takes effect at once (no undo: pairing again is quick): its cookie stops
  working, its open WebSockets close, its push subscription goes.
- **Where it shows.** A phone icon in the bar opens „Telefon verbinden“, so the feature can be
  discovered (it joins the steps `src/ui/barFit.ts` gives up in a narrow bar). The Konfiguration
  dialog gets a section „Von anderen Geräten“ with the setting, what the network allows, the
  address and the devices.

### Reaching the machine

- **The setting „Von anderen Geräten erreichbar“**, off by default; off, Obeya stays as it is today.
- **With Tailscale** running and logged in, Obeya keeps listening on `127.0.0.1` and runs `tailscale
  serve --bg` for its own port (the one the server runs on, which the app may have picked), which
  proxies HTTPS and WebSockets from `https://<machine>.<tailnet>.ts.net`; the address comes from
  `tailscale status --json`. Turning the setting off removes that serve entry, and only that one.
  Where 443 already serves something else, Obeya takes another HTTPS port.
- **What Obeya cannot do itself**, the section says, each with its one step: HTTPS turned off in the
  tailnet (a link to the tailnet's DNS page in the Tailscale admin console), Tailscale logged out
  (log in), Tailscale missing (how to install it, per platform), on Linux the operator right that
  `tailscale serve` needs (the command to run once).
- **Another VPN.** Without Tailscale the owner may pick an address beyond `127.0.0.1` to listen on
  (the VPN's interface, say). That is plain HTTP: the phone view works, but the section says that
  the microphone and push need HTTPS, which phone browsers give only on HTTPS.
- **While the server runs.** The phone reaches Obeya only while its server runs: quitting the app
  stops it (design: App), the section says so.

### The phone view

- **Same address, same app.** On a phone the page shows the phone view instead of the canvas
  (`src/ui/phone.tsx`, its strings in `src/ui/strings.ts`). It shows on a coarse pointer with a
  screen whose short side is under 600 px, so a tablet and a narrow desk window keep the canvas;
  `?view=phone|canvas` decides instead.
- **„Für dich“** lists what waits for the owner across all canvases (`needsYou`, and Obeya when an
  answer waits unread), canvas by canvas in the switcher's order and within a canvas in Tab order,
  each row with what it waits for (demo, question, proposal, failed landing, an idea's turn), its
  title, its canvas and since when. **„Läuft“** lists the working cards with their status line.
  Obeya's conversation is at the bottom, with the microphone (hold to talk), a text field and
  screenshots. The page needs every canvas's snapshot: it holds one WebSocket per canvas.
- **A card opened** fills the screen: its conversation, the answer options and Send, the demo video
  full width (and full screen), the approve buttons with the usual undo, accepting or rejecting a
  proposal, an idea's discussion with „So bauen“. Back returns to the list. It uses the shared
  components (the conversation, answer options, sending while the agent works, the drafts of
  `src/ui/draft.ts` and `src/ui/keep.ts` surviving a reload): no phone copies of them.
- **Touch.** The microphone is held by touch (pointer events, no long-press menu, no text
  selection). A field's screenshot picker offers the photo library and the camera
  (`accept="image/*"`). Marking a screenshot works with a finger as with the mouse.
- **The machine stops answering**: the phone view says since when („Obeya antwortet nicht · seit
  14:02“) and reconnects by itself, as the page does today.
- **Not on the phone:** the configuration, the setup assistant, the diff, moving cards and groups.

### Push

- **Web Push to the home-screen web app.** Obeya serves a web app manifest (name, the icons of
  `src/ui/logo/`, standalone) and a service worker at its root. It holds its own VAPID key in its
  home and needs no account. The payload is encrypted for the device (RFC 8291) and signed with the
  VAPID key (RFC 8292) through WebCrypto; it travels through Apple's or Google's push service, which
  sees neither title nor text. A subscription belongs to its paired device; one the push service
  answers with 404 or 410 is dropped.
- **Home screen.** On iOS push needs the web app on the home screen (16.4+): in Safari the phone
  view shows how („Teilen“ → „Zum Home-Bildschirm“) until it runs standalone. There a button
  „Benachrichtigungen einschalten“ asks for the permission (iOS asks only after a tap) and stays
  until it is granted or refused.
- **What is pushed:** a card starts waiting for the owner (`needsYou` turns true), a landing fails,
  a worker gets stuck (its turn failed or ended without a handover, and Obeya made a question of
  it; the push says it is stuck, not that it asks).
- **Not while the owner is at the machine:** nothing is pushed while a local page was visible in
  the last few minutes. The page tells the server when it goes hidden too, not only when it comes
  back.
- **Several at once:** the first event goes out at once; further ones within the minute after go
  out as one push at its end („3 Karten warten auf dich“).
- **Tapping a push** opens that card in the phone view; a push for several opens „Für dich“.
- **Keeping the shell.** The service worker keeps the page's shell, so the home-screen app opened
  while the machine sleeps shows that Obeya does not answer instead of the browser's error.

### Keeping the machine awake

While „Von anderen Geräten erreichbar“ is on and a worker is in a turn (or its background work
runs), Obeya keeps the machine from idle sleep, and lets go a short while after the last one ends:
`caffeinate -i -w <pid>` on macOS (it ends with Obeya), `SetThreadExecutionState` with
`ES_CONTINUOUS | ES_SYSTEM_REQUIRED` on Windows, `systemd-inhibit --what=idle:sleep` on Linux. The
display may still sleep. With no worker at work the machine sleeps as it is set to, and the phone
view says that it does not answer. A closed MacBook lid on battery sleeps regardless; the section
„Von anderen Geräten“ says so. SSH hosts keep their own power settings.

### Testing

- The Origin and Host check and pairing: server tests with forged `Host`, `Origin`,
  `Sec-Fetch-Site` and `X-Forwarded-For`, and the two requests above refused.
- `tailscale`: a fake `tailscale` on the `PATH` in tests; once live against the owner's tailnet,
  which needs the owner to log in to Tailscale on the Mac and turn on HTTPS in the tailnet.
- The phone view: the headless browser (`obeya:browser`) emulating a phone's viewport and touch.
- Push: the encryption against a local test endpoint that decrypts as a browser does. Push and the
  microphone on a real iPhone, in standalone mode, need the owner once, in the demos of W3 and W4.

## Workstreams

- [x] **W1:** Origin and Host check. Every request and WebSocket upgrade checked as under Who may,
  from localhost too. Done when the cross-site `text/plain` POST and the foreign `Host` from Where it
  stands are refused, the canvas, the app (its stop included), the scratch Obeya and the scripts
  still work, and a worker's HTML artifact still shows.
- [x] **W2:** Access. Local or remote, pairing with the QR code and the device cookie, the device
  list with „Entfernen“, the setting „Von anderen Geräten erreichbar“ with `tailscale serve` and
  what the network needs, another VPN's address, the phone icon in the bar and the section in the
  configuration (see Who may, Reaching the machine). Settles how long a device stays paired. Done
  when the owner's phone, paired by the QR code over the tailnet, opens the canvas at the HTTPS
  address, and a removed phone no longer does. Needs W1.
- [x] **W3:** The phone view. „Für dich“, „Läuft“ and Obeya's conversation, a card opened full
  screen with the shared components, touch for the microphone and screenshots, the machine not
  answering (see The phone view). Settles the rule for when it shows. Done when, on a phone over
  the tailnet, the owner answers a question, approves a demo, accepts a proposal, gives Obeya a
  spoken task and sends a photo, and what they typed survives a reload. Needs W2's HTTPS for the
  microphone.
- [ ] **W4:** Push. The manifest, the service worker, the VAPID key and subscriptions per device,
  the home-screen hint, what is pushed and when, tapping a push (see Push). Done when the owner's
  iPhone, with Obeya on its home screen and the desk idle, gets a push for a demo waiting and
  opens that card from it, and gets none while the canvas is in view at the desk. Needs W2 and W3.
- [ ] **W5:** Keeping the machine awake. The sleep assertion per platform while remote access is on
  and a worker works, and the note about the lid (see Keeping the machine awake). Done when, on the
  Mac, `pmset -g assertions` shows Obeya's assertion while a worker is in a turn and not after, and
  the same is checked on Windows and Linux. Independent of W3 and W4; it can run beside them.

## Dropped variants

- A public tunnel (Cloudflare Tunnel, ngrok): it puts agents with shell rights on the open
  internet.
- Obeya's own relay: a cloud service, against "no cloud service for now" (2026-10-06).
- A messenger bot: the content passes through a third party, it is chat-shaped only, and the owner
  chose the private network.
- The canvas made touch-capable: readable card sizes on 390 px mean mostly panning.
- A native app: nothing a home-screen web app cannot do here.
- ntfy or a messenger for the push: a third party, and nothing Web Push does not do.

## Open questions

None. The phone view shows on a coarse pointer with a screen's short side under 600 px (W3).
