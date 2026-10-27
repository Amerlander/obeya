## Sharing demos

A chapter of the [design doc](../design.md), whose header says how it is written.

### Sharing a demo

Every demo, video or HTML artifact, has a compact "Teilen" button at the right end of its own line
(see Earlier demos), on waiting, done and archived cards alike; prototypes are not shared. Once
shared, the line holds the link, "Link kopieren" and "Nicht mehr teilen".

#### Where a demo goes

With a complete demo site in the repository's settings (see Static sites), "Teilen" publishes the
demo on a page there at once, without a hold; "Nicht mehr teilen" withdraws it as easily. Without
one, it exports a file (see Export without a site). Pages go out one change at a time through one
queue for all canvases, which resumes after a restart. The slug comes from the card's title and id
once and stays, so the link survives republishing. The deploy's output goes into the card's log; a
failure is logged as an error and leaves the card as it was.

The page has a title and two to five sentences for colleagues who have never seen Obeya, which
`ready_for_review` takes with every demo where the repository has a site (`demo.page`); for a demo
without them, a short read-only session writes them from the worker's last summary when the owner
shares, kept with the demo from then on.

#### Several versions on one page

A card has one page under one link, holding the demo versions the owner shared, in order of
handover: the first on top with the page's title and text, each later one below as „Ergänzung vom
16.10., 13:37“ (its handover's time, formatted by Obeya, since ICU joins the parts differently on
macOS and Linux) with its own title, text, chapters and demo. With two or more, a list of them stands
under the title.

The share box is about the version shown in the demo's line. On a version on the page: its link,
"Link kopieren" and "Nicht mehr teilen" (the page goes out again without it; the last one takes the
page down). With earlier demos on the card, a line says which versions the page holds („Auf der
Seite: Demo 1 und 2“). On an earlier version not on the page, "Teilen" adds it in its place by
handover. On the latest, not on the page, the hint „Die geteilte Seite zeigt Demo 1.“ offers „Auf
der Seite ersetzen“ and „Zur Seite dazunehmen“. Which comes first is the worker's word:
`ready_for_review` says of a later demo whether it was recorded afresh (`follows: replaces`) or
supplements the one before (`supplements`), the demo skill asks for it, and a sentence under the
buttons repeats it („Laut Agent ergänzt dieses Video Demo 1.“); without it, replacing comes first.
Nothing goes out without the owner's click.

#### A shared artifact

An artifact's page shows the title and text above the artifact in a sandboxed frame that grows to
the artifact's reported height (`postMessage`, at most 30 steps, as an artifact as high as its window
would grow on). „In eigenem Fenster öffnen“ shows the same page with the frame filling the window
(`?alone`). The artifact may open no window: a popup could leave the sandbox or reach any server.

The frame's origin is `null`, and a static site cannot hand out keyed addresses as Obeya does (see
The demo on the card): hosts send no or a wildcard CORS header, a ZIP from disk loads no CORS request,
and behind a login (Cloudflare Access) the frame's requests for files go cross-site without the
login's cookie (Firefox always, Chrome unless `SameSite=None`), so the login answers with its own
page. From disk Chrome loads nothing at all beside a sandboxed page. So the artifact's copy
(`src/server/artifact-copy.ts`, for site and ZIP) loads no file beside its pages: module scripts are
bundled in (CDN and package imports stay imports, comments naming this machine's paths go, a script
that does not bundle stays as it is), the files its pages name (images, `srcset`,
media, classic scripts, stylesheets and their imports, fonts, icons, CSS `url()`s) go in as `data:`
URLs, and the files its scripts may fetch are embedded, `fetch` and `XMLHttpRequest` answering GETs
for them. `<base>`, `#` parts and `srcset` are read as browsers read them. A page grows with its
images and stays under the host's file limit; `data:` URLs stop at 64 MiB a page. A file goes in only
if its real path lies in the artifact's directory, and a module whose bundle took in code from
outside stays unbundled; build macros are off. Otherwise a worker steered by what it read could put
an owner's file into a public page. Still not loading: a Web Worker's script, an `import()` of a
computed path, a font set from a script, and behind a login a file a script names at run time. A
ZIP's page opened from disk lets the frame keep its origin (`file:` has no site to protect).

A shared page sends nothing to the internet, under the rule of a worker's page inside Obeya (see The
demo on the card): each HTML page of the copy starts with that CSP as a meta tag (own files, inline,
`data:`, `blob:`), naming its files by `'self'` and the site's address (for Safari), in a ZIP by
`file:`; a single-file export carries it through `srcdoc`. The page around allows its frame only its
own files, so the artifact cannot navigate elsewhere, and turns DNS prefetching off. Where the host
reads `_headers` (Cloudflare Pages, Netlify), Obeya writes one: the artifact's files get the CSP, the
sandbox (opened directly, a file does not run in the site's origin) and `Connection-Allowlist:
(response-origin)` against `preconnect` and WebRTC (Chrome 152 on). Elsewhere, and in Firefox and
Safari, those two stay open (no meta tag carries the header, no engine heeds `webrtc 'block'`), as
does an SVG with scripts opened in the frame; under `file:` the artifact may load any file of the
disk.

#### Outdated pages

What changes on the pages is written down as it changes (`PAGE_CHANGES` in
`src/core/page-changes.ts`): each change a viewer sees, with the kinds of page it shows on (video,
artifact, both) and its words. A share keeps the newest change at publishing; later changes that show
on its versions' kinds make it outdated. Its card lists them with their days, beside "Erneut
teilen" (same versions, same link) and "Nicht mehr teilen"; the latest demo not yet on the page
brings them with replacing or adding. A change that shows nowhere gets no entry. A test pins a hash
of sample pages (both languages, both kinds, several versions) and fails once they differ, asking to
add an entry where a viewer sees it and to take the new hash. A new site title shows with the next
publish without marking pages. A page whose demo files are gone (demos get deleted to free space) is
neither offered nor counted.

Many at once go from the Koordinator's sheet: while pages are outdated, an entry says how many
(„N geteilte Demos sind veraltet“, archived cards' included), lists the changes with their days and
how many pages lack each, and shares again the newest 20 (or 10, 50, 100, all). They go through the
same queue as the share kept them (a newer demo on the card still waits for the owner), a share the
owner starts slipping in between. The entry shows progress and the failed ones with their cards;
"Anhalten" stops after the current page; "Ausblenden" hides the entry until a newer change outdates
pages. The run survives a restart; a page shared again on its own, withdrawn or deleted meanwhile
drops out of it. It is not counted on the Koordinator button: each card offers "Erneut teilen", and
nothing is lost by leaving them.

A page published again with the same video keeps its date („Geteilt am“), so the overview keeps its
order; a new video dates it anew.

#### The page and the pull request

A demo shared before approval goes into the worker's approval message with "link it in the
description". Once a PR exists and the page is out, in either order, Obeya adds to the PR description
(unless it already contains the URL) a line `Demo-Video: <url> <!-- obeya:demo -->` (`Demo-Seite:`
for an artifact; „Demo video:“/„Demo page:“ in English), replacing its own earlier line by the
marker. A page shared before the PR existed is republished with the PR's link, as it showed then; a PR
reported while the page is going out gets a second round after it. A failure goes into the card's log; the page stays shared. Withdrawing leaves the line. A review card's pull request is the contributor's: its
description stays as it is, and once the owner approved, the page's link goes into a comment on it
instead (`Demo-Video: <url>` in the demo's language), once per page.

#### The page and the landing

The message telling a worker its work landed, its PR merged, or its work closed without a change
names the demo's page: its URL once it is online, or that the page shows an earlier demo. A page
still going out says Obeya will send the address: the session stays past the end of the turn, and
once the deploy that puts the latest demo on the page finishes (not one still under way before it)
Obeya sends the URL, or the failure's reason with "ask the owner for a link". A worker that closes
its card as needing no PR hears the same in the tool's result. If the deploy finished while Obeya was down, the worker hears where the page stands at the
end of its next turn. Without a demo site, or with the demo not shared, the message says so and
tells the worker to ask the owner before pointing anyone to the demo, so an issue is not closed
without a link (CLAUDE.md asks workers to link the demo when they close one). The URL is known
before the deploy (the trailer uses it), but a link given then would point to a page that is not
there yet, or never will be if the deploy fails (decided 2026-10-26).

#### Publishing on approval

A site may publish every approved demo by itself (`demo.site.publish: "approved"`, a choice in
Konfiguration); Obeya's own repository does, onto `demos.obeya.si`. There, until approval, the
latest demo not on the page has a checkbox „Mit der Freigabe teilen“ (ticked) beside the button,
which then reads „Jetzt teilen“. Unticked, approving shares nothing and the log says so. The choice
stays with the card and takes effect at once.

On approval, before landing, the latest demo goes on the page as the owner's click would: a new page,
or beside the versions where its worker said it supplements, else in their place, after any share
still going out; a log line says so. It goes through the queue, so landing does not wait; a failed
deploy is logged and the card keeps "Teilen". The same holds for approved PR work, work closed
without a change, and a held approval landed by the worker's next handover (the newer demo goes).

Where a repository lands on `main` directly, the landing commit of a card with a page names it in a
git trailer, `Demo-Video: <url>` (`Demo-Page:` for an artifact), beside the closing trailers. The URL
comes from the fixed slug, so the trailer is there before the deploy finishes. Obeya amends the
rebased branch's last commit (`--no-verify`, author kept), skips a trailer already there, and lands a
commit it cannot amend without one. A publish that succeeds for a landing that then fails leaves a
public page for work not on `main`; accepted, since the next handover lands it.

#### Export without a site

Without a site, "Teilen" exports the page (`GET …/cards/<id>/export?as=zip|html`): a ZIP with a
folder named by the slug, the video, poster and captions beside `index.html`, or one HTML file with
the video in base64, played from a blob so it seeks, for videos up to 15 MiB so it still goes by mail
(the button says so otherwise). An artifact goes into the ZIP under `artifact/`, or into one HTML file
as `srcdoc` only when `index.html` is its only file. Nothing leaves Obeya, so an export is not held;
the log names the file. It packs the version shown, one per file. Captions go in as cues in a script,
since Chrome loads no `<track>` from disk. The ZIP is stored uncompressed.

The page is the site's, without the overview link. Its own words are in the demo's language (the one
its `index.html` names, else the demo settings' narration language, else German). Its video waits
under a big play button; a click anywhere on it but the controls starts it. No autoplay: browsers
play sound only after a click on the page, and the owner did not want it muted.

Every page and every overview ends in „Aufgenommen mit Obeya“ ("Recorded with Obeya") linking
https://obeya.si, without a setting to turn it off; `?alone` leaves it out.

#### Static sites

A static host takes the site as a directory, deployed whole with each change. Obeya keeps it under its
home, refuses before deploying a file over the host's limit and a directory lacking a page Obeya has
as shared, and restores it when a deploy fails. Some hosts serve no byte ranges (Cloudflare Pages),
so the page asks for a range first and, getting the whole file, plays the video from memory, as a
browser cannot seek in it otherwise.

`demo.site` in the repository's settings (once trusted, see Trusting a repository's commands):

- `title`: the overview's heading and the pages' tab titles; `url`: pages at `url/<slug>/`;
- `deploy`: a command line, `{dir}` for the site's directory;
- `env` (optional): a `KEY=value` file under Obeya's home with the deploy's credentials; a path
  outside the home is refused, and `${KEY}` comes from that file only, so a repository's settings
  cannot send the machine's secrets anywhere;
- `headers`: for reading the live site behind a login; `maxFile`: the host's file limit (25 MiB
  default); `publish`: see Publishing on approval.

The overview is in `demo.language`, else the narration language. Konfiguration has a field for each.
A site counts once it has a title, an http(s) URL and a deploy command; an unusable one (incomplete,
deploy program missing) is a problem shown at the repository.

The deploy runs in `share/` under Obeya's home with `OBEYA_HOME` and `OBEYA_REPO` set, not in the
checkout, where leftovers (wrangler's cache) would keep a pool workspace from being leased. Its words
are split at spaces outside quotes; programs and scripts are found in the repository; `.ts` and `.js`
run with Obeya's Bun, so the line works on Windows. Any host that takes a directory fits: Cloudflare
Pages, Netlify, Vercel, `aws s3 sync`, `rsync`, a Pages branch, a script.

The site lives in `sites/<key>/` under Obeya's home, the key from the URL's host and path, shared by
all repositories naming it. `site/` holds a directory per page (demo files, `index.html`,
`meta.json`: kind, title, text, chapters, PR, first shared, last changed, a hash of the demo's own
files, language, who shared it, and under `more` the later versions, their files in `2/`, `3/` …),
the overview, dated by each page's newest version, and an Atom feed (`feed.xml`, linked from the
overview as „Feed abonnieren“ and by `<link rel="alternate">`) with one entry per page in the overview's order (title,
first sentence as summary, the whole text as content, the page's address as link and id, the
overview's date, the page's language, who shared it as author), written together and so equally
current. A page keeps its date while its demo's own files stay the same.

Each page names who shared it („Geteilt von Ada Lovelace am 20. Oktober 2026“), and the overview
after the date, as colleagues publish to one site from their own Obeya: git's `user.name` in the
card's repository, left out where none is set.

A machine without the site's `env` file exports, with a line naming the missing file; once placed,
it counts when the owner comes back. A site without `env` deploys with the machine's own login.

#### Several machines on one site

Each deploy replaces the whole site, so a machine must pull before it pushes. The site carries
`obeya-site.json`: every page with its metadata, files with size and hash, a revision and the
writing machine; withdrawn pages stay as tombstones so a stale machine does not revive them. Only the
machine whose card a page is changes it.

Before every publish or withdrawal Obeya reads the live manifest (with `headers`), downloads missing
or newer pages (a new machine's first share fetches all, logging every 25 pages), drops withdrawn
ones, keeps pages the live site lacks, writes, and deploys. Redirects within the site are followed
(Cloudflare Pages redirects `…/index.html` to `…/`); one elsewhere is a login. Just before deploying
it rereads the manifest and starts over if another machine deployed. After deploying it polls for
about 30 s (if the site never shows it, the deploy counts, with a log line saying so); another
deployment that dropped the change makes it redo once, a second fails the share.

A deployment racing past this check still takes a page offline (no compare-and-swap on a static
host): the once-a-minute check when the owner comes back redeploys pages the live site lacks or has
older, with a line on their cards. An unreadable manifest refuses the deploy; a 404 is the first
deploy; a manifest answered with the host's fallback page (HTTP 200) counts as missing. A page
another machine withdrew loses its link here, with a line naming the machine.

### Decisions

- **Sharing belongs to a demo version; one page per card holds the shared versions, oldest on top**
  (owner, 2026-10-16): a later demo often only corrects a detail and is read after what it corrects.
  Rejected: replacing the page with each demo, newest first, one player with a version switcher (a
  colleague might never find the other), a page per version (several links for one change).
- **"Teilen" sits on the demo's own line** (2026-10-14). Rejected: a full-width button under the
  chapters, out of sight under many chapters or a tall artifact.
- **A shared artifact's pages load no file beside them** (2026-10-16, 2026-10-20): behind Cloudflare
  Access the frame's requests lack the login's cookie (Firefox showed only alt texts), and from disk
  nothing loads in CORS mode. Rejected: `allow-same-origin` (the artifact's scripts could read the
  whole site with the viewer's cookie), and the page around fetching files for the frame (fails from
  disk; markup lacks images until a script inserts them).
- **HTML artifacts are shared too** (2026-10-05): an analysis with charts is background for a pull
  request as much as a video.
- **Sharing takes effect at once** (2026-10-02). Rejected: an 8 s hold with "Doch nicht";
  withdrawing is as easy.
- **On approval, sharing only when „Mit der Freigabe teilen“ stays ticked** (2026-10-20), with
  „Jetzt teilen“ beside it, so a demo can go to colleagues for review before approval. Rejected:
  approval always sharing.
- **Deploys run in `share/` under Obeya's home** (2026-10-05): run in the checkout, wrangler's cache
  blocked the pool workspace from being leased.
- **A page is outdated by a change written down for its viewers** (2026-10-16). Rejected: a hash of
  the pages' bytes, which marked pages outdated without saying what changed, also where nothing
  showed, so the owner could not judge whether resharing 70 pages was worth it.
- **Each outdated page is updated on its own card** (2026-10-05). Rejected: rewriting every page on
  each share, unseen and slow with hundreds.
- **A shared page speaks the demo's language** (2026-10-07).
- **The overview's language is the repository's `demo.language`** (2026-10-19). Rejected: a
  `language` of the site's own, a second setting for one need; a file that still has it is read
  without it, and the configuration flags it.
- **Static sites are built in from a few settings, and the demo site is the only place "Teilen"
  publishes to** (2026-10-09, 2026-10-15). Rejected: a kit library for per-repository share scripts
  (a script per repository), hosting providers in the core (one deploy line covers them all), a
  share command receiving each page as JSON (unused once sites existed; two unconnected settings for
  one thing). Hosts that cannot take a whole directory are unsupported; a `deploy` script may upload
  only what changed.
- **A page names who shared it by git's `user.name`** (2026-10-20). Rejected: a name setting in
  Obeya (one more field for a name agents already commit under) and the host name (a computer, not a
  person).
- **The credit line has no setting**: settings stay few; a static credit line is common practice.
- **Several machines pull before they push** (2026-10-09). Rejected: refusing deploys while the live
  site has pages missing here (leaves copying by hand), and a shared storage folder or bucket as the
  source (pushes the problem onto each user's setup).
