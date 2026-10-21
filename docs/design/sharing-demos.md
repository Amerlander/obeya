## Sharing demos

A chapter of the [design doc](../design.md), whose header says how it is written.

### Sharing a demo

Every demo, video or HTML artifact, has "Teilen" above it, on waiting cards and on cards long done
(archived ones too); prototypes are not shared. The button sits at the right end of the demo's own
line, a compact button with a share icon, beside the hint where the demo is an earlier one; once
shared, the line holds the link, "Link kopieren" and "Nicht mehr teilen".

An artifact's page has the same title and text above the artifact, which sits in a sandboxed frame
(its scripts reach neither the page nor the site); the copy of its `index.html` beside the page
tells the page its height (`postMessage`), so the frame grows to it instead of scrolling inside the
page, at most 30 steps (an artifact as high as its window would grow on), and "In eigenem Fenster
öffnen" shows it alone: the same page with the frame filling the window (`?alone`). The artifact's
own file opened directly would run in the site's origin, as would a window the artifact opens if
the frame let it leave the sandbox (`allow-popups-to-escape-sandbox`, until 2026-10-16). It opens
no window at all now: a window may go to any server (`allow-popups`, until 2026-10-16).

The frame's origin is `null` there too, and a static site cannot answer the way Obeya does (a keyed
address, see The demo on the card): Cloudflare Pages sends `Access-Control-Allow-Origin: *`, other
hosts nothing; from a ZIP opened from disk no CORS request loads. Behind a login (Cloudflare Access)
no request of the frame for a file gets through at all, an image as much as a module script: the
browser sends it as cross-site, without the login's cookie (Firefox never sends it there, its Total
Cookie Protection keeps a sandboxed frame's requests apart; Chrome where the cookie is not
`SameSite=None`), and the login answers with its own page on another host, which the policy
blocks. The frame's own navigation (its page, a link to another page or an image) carries the
cookie. From disk Chrome loads nothing at all beside a sandboxed page, not even its stylesheets and
images, so the ZIP's page lets the frame keep the page's origin when it is opened from disk
(`file:`; there is no site to keep it from) and sandboxes it as the site does when served. So the
pages of the artifact's copy load no file beside them (`artifactCopy` in
`src/server/artifact-copy.ts`, for the site and the ZIP alike): its module scripts are bundled into
its `index.html` (`Bun.build`; imports from a CDN or a package stay imports, a script that does not
bundle stays as it is, and the comments naming the modules' paths on this machine go); the files
its pages name (an image and its `srcset`, a poster, media, a classic script, a stylesheet with
what it imports and names in turn, a font, an icon, a CSS `url()` in a `<style>`, a `style`
attribute or a script's text) go in as `data:` URLs; and the files its scripts may fetch (all but
images, media, scripts, stylesheets and fonts) go into the page, where `fetch` and `XMLHttpRequest`
get a GET for them answered without asking the site. A `<base>` of the page is heeded (one leading
out of the directory or to another server leaves the page as it is), a `#` part kept (a part of an
SVG), and a `srcset` read as browsers read it. A page with many large images gets large with them
(a third more than the files), and the host's limit for one file (25 MiB without `maxFile`) holds
for it; stylesheets that import each other many times over stop at 64 MiB of `data:` URLs a page
(`DATA_BUDGET`), past which the files left stay URLs. All of it comes from the artifact's directory: a file goes in only where its real
path lies there (`demoFile`), so a link to elsewhere stays out, and a module script stays as it is
where its bundle took in a module whose real path lies outside (a path out of it, a link, a path a
`tsconfig.json` maps a package to; the build's metafile names them); macros (`import … with
{ type: 'macro' }`, code of the artifact run at the build) are off. Otherwise a worker steered by
what it read could put a file of the owner's into a page that goes public with „Teilen“. What still
cannot load in the frame: a Web Worker's script, an `import()` of a path computed at run time, a
font set from a script, and behind a login a file a script names at run time (an image's `src` it
sets).

A shared page sends nothing to the internet either, under the rule a worker's page has inside Obeya
(see The demo on the card): until 2026-10-16 its artifact could still load from and send to any
server once a colleague opened the page. The copy of each of the artifact's HTML pages (its
`index.html`, and any other the artifact may open in its frame) starts with the CSP as a meta tag (`sealed` in `src/core/frame.ts`, `pagePolicy` there): its own files, inline
styles and scripts, `data:` and `blob:`, nothing else, so an import from a CDN stays an import but
does not load. Its files are named by `'self'` and by the site's address (for Safari, as inside
Obeya); in the ZIP by `file:`, since `'self'` need not match a page opened from disk, where the
frame keeps the page's origin. The artifact in the one HTML file has no files of its own and gets
the policy without any (`srcdoc`, which also keeps the policy of the page around it). The page
around the artifact has a policy of its own (`artifactPageHtml` in `src/server/demo-page.ts`): it
shows nothing in its frame but its own files, so the artifact cannot navigate the frame to another
server (a link, `location`); the copy turns DNS prefetching off. A host that reads a `_headers`
file (Cloudflare Pages, Netlify) gets one at the site's root (`artifactHeaders` in
`src/server/site.ts`): the artifact's files come with the same CSP, with the sandbox, so a file
opened directly does not run in the site's origin, and with `Connection-Allowlist:
(response-origin)`, which keeps a `preconnect` and WebRTC to the site (Chrome 152 on). Without
those headers, on another host or in an export, those two stay open, as they do in Firefox and
Safari (a meta tag cannot carry `Connection-Allowlist`, and `webrtc 'block'` is heeded by neither
Chrome nor WebKit), and so does a file that runs scripts without being an HTML page (an SVG the
artifact opens in its frame), which no meta tag reaches. Under `file:` the policy lets the artifact
load any file of the disk, not only its own; `'self'` matches them all as well, in Chrome and
WebKit alike.

#### Where a demo goes

Where it goes depends on the repository's demo site: the static site its settings name, once it is
complete (`demo.site`, see Static sites; `siteOf` in `src/server/canvas.ts`). With a site, the demo
is published on a page there. "Teilen" publishes right away, without a hold to take it back: "Nicht mehr
teilen" withdraws the page just as easily. Once the page is up, the card shows the link (open, copy)
and "Nicht mehr teilen". Nothing is replaced on its own, unless the site publishes on approval (see
Publishing on approval).

#### Several versions on one page

Sharing belongs to a demo version, not to the card: a card has one page under one link, and the
page holds the versions the owner shared, stacked in order of handover. The first one shared is on
top with the page's title and text; each later one is below it as „Ergänzung vom 16.10., 13:37“
(„Addendum of Oct 16 at 13:37“), the time of its handover (its parts joined by Obeya, not by the
platform's ICU, which joins them differently on macOS and Linux), with its own title, text, chapters and video or
artifact; with two or more, a list of them stands under the title. A page with one version looks as
it did before (until 2026-10-16 a page held one demo), so those pages are not outdated by it. A
later demo often only corrects or explains one detail, and standing below the one it corrects it
is read after it; a page newest first, one player with a version switcher (a colleague would see
one version and might never find the other) and a page per version (several links for one change)
were dropped.

The share box is about the version shown in the line above the demo (see Earlier demos). On a
version on the page it holds the link, "Link kopieren" and "Nicht mehr teilen" for that version:
the page goes out again without it, and the last one takes the page down. With earlier demos on
the card, a line says which versions the page holds („Auf der Seite: Demo 1 und 2“); a card with
one version shared and no earlier demos reads as before. On an earlier version not on the page,
"Teilen" adds it in its place by handover. On the latest, not on the page yet, the hint „Die
geteilte Seite zeigt Demo 1.“ offers „Auf der Seite ersetzen“ (it goes on the page, the shared
ones off) and „Zur Seite dazunehmen“ (it goes beside them); the buttons name the page, since the
choice is about what the page shows, not about the card's demos. Which comes first is the worker's word: `ready_for_review`
says of a later demo whether it was recorded afresh (`follows: replaces`) or only supplements the
one before (`supplements`), the demo skill asks for it, and a line under the buttons says what the
worker said, as a sentence about the video („Laut Agent ergänzt dieses Video Demo 1.“ / „… ist
neu aufgenommen und ersetzt Demo 1.“; until the owner's feedback on 2026-10-16 a label, „Der
Agent: ergänzt Demo 1“, which did not say what was supplemented). Without its word „Auf der Seite ersetzen“ comes
first, as the latest demo always replaced the page before. The worker only suggests: nothing goes
out without the owner's click.

The page has a title and two to five sentences for colleagues who have never seen Obeya: where the
repository has a site, `ready_for_review` takes them with every demo (`demo.page`), and for a demo
handed over without them a short read-only session writes them from the worker's last summary when
the owner shares, kept with the demo afterwards.

#### Publishing

Pages go out one change at a time, through one queue for all canvases (`src/server/share.ts`):
`publish` writes the card's page on its site (slug, kind `video` or `html`, title, text, chapters,
PR URL, the demo's language, demo directory, the later versions with the same and their handover's
time, and the slugs of the other pages shared there), and `withdraw` takes it down. A share keeps
each version on the page (`StoredShare.demos`: its handover, directory and what the page says of
it); a share from before (one `dir` and `shown`) reads as a list of one and is converted at startup. The slug comes from the card's title and id once and stays, so a link
keeps working across publishing again. What the deploy says goes into the card's log, a failure
with its output as an error, and the card stays as it was. A share publishing or withdrawing at a
restart goes on after it.

#### Outdated pages

Inside Obeya a card's pages go to its share target (`ShareTarget` in `src/server/share.ts`, its
site): pages whose targets have the same key (the site's URL's host and path) are on one site, so a
publish names the others. Keys are not stored.

What changes on the pages is written down as it changes: `PAGE_CHANGES` (`src/core/page-changes.ts`)
lists each change a viewer of the pages sees, oldest first, with the kinds of page it shows on
(video pages, artifact pages, or both), its words in the UI's strings (`pageChanges`, by id). A
share keeps the newest change when it was published (`version`, '' before any). The changes after
it that show on its kind of page are what sharing it again brings; a page that lacks one is
outdated and shows them on its card, each with its day ("Seit diese Seite geteilt wurde, haben sich
die Seiten geändert: …"), beside "Erneut teilen" and "Nicht mehr teilen": the same demo published
again under the same link, with all its versions. A page's changes are those of the kinds of page
its versions show (a video and an artifact on one page: both). The latest demo, not on the page,
brings them with „Auf der Seite ersetzen“ or „Zur Seite dazunehmen“.
Each page is brought up to date on its own card. A change that shows nowhere (a refactoring, a style
only the other kind of page uses) gets no entry and marks no page. That the list misses no change
is a test's: `PAGES_HASH` pins a hash of sample pages in both languages with everything a page can
have (`pagesHash` in `site.ts`: a video page, an artifact page and a page with several versions,
its addenda's times in UTC so the hash is the same on every machine), and the test fails once the pages come out different, saying to add
an entry where a viewer sees the difference and to take the new hash either way. The site's title
is not part of it: a new title shows on the overview with the next publish and on each page once it
is published again. Pages published before the list (until 2026-10-16) kept a hash instead; at
startup their change is read off the page in the site's directory, once. A page whose demo files
are gone (demos get deleted to free space) is neither offered nor counted: there is nothing to make
it from again, and it stays out as it is.

Many at once go from the Koordinator's sheet: while pages are outdated, a purple entry says how many
(„N geteilte Demos sind veraltet“, archived cards' included), lists what changed since, each change
with its day and how many of them lack it, and shares again the newest 20 of them
(or 10, 50, 100, all), newest by the video file of the newest version on the page. They go out one after the other through the
same queue as every share, each published as it shows (what the share kept, so a newer demo on the
card still waits for the owner), and a share the owner starts meanwhile goes out between two of
them. The entry shows how many are out, the one going now, and the failed ones with their cards (the
reason is in each card's log, the page stays outdated); "Anhalten" lets the page going out finish
and leaves the rest. "Ausblenden" puts the entry away, with the result of a finished run: the owner
has shared as many again as were worth it. It comes back for the pages a newer change leaves
outdated (setting `reshare_dismissed`, the newest change when it was put away); the cards go on
offering "Erneut teilen". The run is kept (setting `reshare`), so it
goes on after a restart; a page shared again on its own meanwhile, withdrawn or deleted drops out of
it. It is not counted on the Koordinator button: the cards offer "Erneut teilen" each, and nothing
is lost by leaving them.

A page published again with the same video keeps its date („Geteilt am“) on a site that shows it, so
the overview keeps its order when pages are brought up to date or get their PR's link; a new video
dates it anew.

#### The page and the pull request

The pull request and the page link each other. A demo shared before approval goes into the worker's
approval message with "link it in the description". Once a PR exists and the page is out (in either
order: `pr_opened` after sharing, or sharing a card whose PR is open or merged), Obeya reads the
description through the forge (`gh pr view --json body`) and, unless it contains the page's URL
already, adds a line `Demo-Video: <url> <!-- obeya:demo -->` (`Demo-Seite:` for an artifact; „Demo
video:“ and „Demo page:“ in English) (`gh pr edit --body-file`); a later line of its own is found by
the marker and replaced, not added again. A page shared before the PR existed is published again
with the PR's link: what it showed then (title, text, chapters and demo directory, kept with the
share, every version on the page), not a newer demo on the card, which still waits for the owner. The card goes on showing
the link meanwhile; a PR reported while the page is going out gets a second round after it. A
failure to read or edit the description goes into the card's log; the page stays shared. Withdrawing
the page leaves the line in the description.

#### Publishing on approval

A site may publish every approved demo by itself (`demo.site.publish: "approved"`; „Auf die Site
kommt eine Demo: beim Klick auf „Teilen“ / mit der Freigabe“ in Konfiguration): Obeya's own
repository does, so its feature demos are public on `demos.obeya.si` without anyone clicking
"Teilen" for each. Without it a demo goes out only on that click, as before.

The owner decides per card: until the card is approved, its latest demo not on the page has a
checkbox „Mit der Freigabe teilen“ ("Share on approval", ticked) beside the button, which reads
„Jetzt teilen“ ("Share now") there. Unticked, approving shares nothing, and the card's log says so
(„Mit der Freigabe nicht geteilt“); a demo the owner wants to discuss with colleagues or have them
review before approving goes out with „Jetzt teilen“. Both are needed: until 2026-10-20 such a card
had only "Teilen", and approving always shared. The choice stays with the card across handovers,
sharing and withdrawing (`notOnApproval` in its stored share, `onApproval` in `src/server/share.ts`,
the card action `shareOnApproval`); the repository says it publishes on approval in its
`shareOnApproval`. It takes effect at once, without an undo: a click ticks it again.

On approval, before the work lands (`Sharing.approved`, called by the workers through
`onApproval`), the card's latest demo goes on its page unless it is there already, as the owner's
click would put it: on a new page; on a page with versions, beside them where its worker said it
only supplements the one before (`follows: supplements`), else in their place, as „Auf der Seite
ersetzen“ comes first on the card; a share the owner started that is still going out goes first,
the latest demo after it. A line in the card's log says which („Mit der Freigabe geteilt“). It goes through the queue like any share, so the landing does not wait for the deploy;
a deploy that fails goes into the card's log as an error, the card lands all the same and keeps
"Teilen" to try again. The same happens for an approval of work that goes out as a pull request
(the page gets the PR's link once both are there, see The page and the pull request), for work that
changed nothing (closed as done), and for a held approval when the worker's next handover lands it
(a newer demo handed over meanwhile is the one that goes out). Prototypes are not shared.

Where a repository lands on `main` directly (`land: main`, or "Direkt auf main"), there is no pull
request to link the page from, so the commit that lands for a card with a page names it in a git
trailer: `Demo-Video: <url>` (`Demo-Page: <url>` for an artifact, by the page's first version), in
English as git trailers are, beside the trailers the message ends with (`Co-Authored-By`), else in
a paragraph of its own (`addTrailer` in `src/server/workspaces.ts`). A card with a page counts
whether the page went out on approval or by an earlier click. The URL of a page going out comes from its slug,
fixed when the card was first shared, so the trailer is written before the deploy is done
(`ShareTarget.pageUrl`); a page at rest gives the URL it was published at. Obeya amends the last commit of the rebased branch before it lands
(`--no-verify`: its hooks ran when the worker made it; the author stays), and leaves out what is
there already, since a landing that went back to the worker comes round again. A commit that
cannot be amended lands without the trailer. A page withdrawn later leaves the trailer pointing
nowhere, as it leaves the line in a PR's description. A publish that succeeds for a landing that
then fails leaves a public page for work not yet on `main`; that was accepted, since the next
handover lands it.

#### Export without a site

Without a site, "Teilen" exports the same page as a file to pass on (`Sharing.export`, `GET
…/cards/<id>/export?as=zip|html`): a ZIP with a folder named by the slug that holds `index.html`
with the video, poster and captions beside it, or one HTML file with the video in base64, played
from a blob so it seeks; only for videos up to 15 MiB (`EXPORT_HTML_MAX`, so the file still goes by
mail), the button says so for larger ones. An artifact goes into the ZIP in `artifact/` beside the
page; into one HTML file (as the frame's `srcdoc`) only when it is its `index.html` alone, which the
handover notes (`single`), else the button says it goes as a ZIP. Nothing leaves Obeya, so an export
is not held; the card's log names the file. It packs the version shown above the demo
(`?demo=<handover>` for an earlier one), one per file: an export keeps no state, so there is no page
to add to. Both pages carry their captions as cues in a script,
since Chrome does not load a `<track>` for a page opened from disk. The ZIP is written by Obeya
(`src/server/zip.ts`, stored without compression: the video is compressed already).

The page (`src/server/demo-page.ts`) is the one the site publishes, without its link to the
overview. Its own words
(the date line, the captions' name, the links, the play button) are in the demo's language: the one
the demo's `index.html` names (the director writes the report page in the narration language; an
artifact names its own), else the narration language of the demo settings. A page made without a
language is German. Its video waits with a big play button over it until
it first plays: a click anywhere on the video but its controls starts it, rather than the small
button in the corner. It does not start on its own: browsers play sound only after a click on the
page (in Obeya, the click that opens the card), so it could only start muted, which the owner did
not want.

Every page, exported or on a site, and every site's overview end in a small line saying what made
them, „Aufgenommen mit Obeya“ ("Recorded with Obeya") in the page's language, linking
https://obeya.si: a viewer who likes a demo finds where it came from. It has no setting to turn it
off: settings stay few, and a static credit line is common practice. An artifact shown alone
(`?alone`) leaves it out with the rest of the page.

#### Static sites

A static host takes the site as a directory, deployed whole with each change: Obeya keeps it in a
directory of its own under Obeya's home, writes the page and the overview, refuses files over the
host's limit and a site that lacks a page Obeya has as shared (a lost directory would take them
offline), and puts the directory back when a deployment fails. Such a host may serve no byte ranges (Cloudflare Pages
answers a range request with the whole file and 200), and a browser cannot seek in a video streamed
that way: the chapters and the progress bar jumped back to the start. The page therefore asks for a
range first and, getting the whole file, plays the video from memory.

It does that from a few values in the repository's settings (`src/server/site.ts`; a site from
`.obeya/settings.json` once the owner trusted it, see Trusting a repository's commands):
`demo.site` names the site's `title` (the overview's heading, the pages' tab titles), its `url` (a
page is at `url/<slug>/`), the `deploy` command line (`{dir}` stands for the site's directory), optionally an `env` file of
`KEY=value` lines relative to Obeya's home whose values go into the deploy's environment
(credentials, never in git; a path outside the home is refused, and `${KEY}` comes from that file
alone, not Obeya's environment, as settings from the repository could otherwise send any secret of
the machine to a URL of their choosing), `headers` for reading the live site behind a login (`${KEY}` from
`env`), the largest file the host takes (`maxFile`, 25 MiB without it) and whether each approved
demo goes on the site by itself (`publish`, see Publishing on approval). The overview is in the
repository's `demo.language`, else the demo settings' narration language: until 2026-10-19 the site
had a `language` of its own, which two settings for one need made redundant; a file that still has
it reads without it, the site kept, and the configuration names it as a problem of the repository's
settings. The Konfiguration dialog has a field for each under „Einstellungen“. A site counts once it has a title, an http(s) URL and a deploy command
(`siteIncomplete` in `src/server/share.ts`); until then demos are exported, and a site that cannot
be used (incomplete, or its deploy program not there: `siteProblem`) is the problem `demoSite` at
the repository.

The deploy runs in `share/` under Obeya's home, not in the checkout, which is often a workspace of
the pool too (a file it leaves there, as `wrangler pages deploy` leaves its cache, would keep the
workspace from being leased), with `OBEYA_HOME` set and the repository's checkout in `OBEYA_REPO`.
Its words are split at spaces outside quotes (`commandWords`), a program given as a path and any
script are found in the repository, and a script (`.ts`, `.js`) runs with Obeya's own Bun, so the
same line works on Windows. Any host that takes a directory fits: Cloudflare Pages, Netlify or
Vercel through their CLIs, `aws s3 sync`, `rsync`, a push to a Pages branch, or a script of the
repository's.

The site lives in `sites/<key>/` under Obeya's home, the key made of the URL's host and path, so
clones and repositories naming the same site share it: `site/` is deployed whole with each publish
or withdrawal, one directory per page with the demo's files, its `index.html` and a `meta.json`
(kind, title, text, chapters, PR, when first shared and when its video or artifact last changed, a
hash of the demo's own files, the page's language, who shared it; `more`, the later versions, each with the same
and its handover's time, its files in `2/`, `3/` … of the page's directory), plus the overview,
which dates a page by its newest version, and the site's Atom feed (`feed.xml`), written with the
overview from the same pages: one entry per page in the overview's order, with its title, its text
(the first sentence as summary, all of it as content), its address as link and id, and the
overview's date as updated, its language as the entry's, who shared it as its author. The overview links the feed under its
heading („Feed abonnieren“) and in its head (`<link rel="alternate">`), so feed readers find it.
Since every change writes both and deploys the whole directory, the feed is as current as the
overview, pages pulled from another machine included; a site behind a login has a feed only those
with the login can read. `backup/` holds a page set aside while a deploy runs, put
back when it fails. Pages are written
with Obeya's templates, each in its demo's language ("Geteilt am", "Alle Demos": the language its
report page names, else the repository's `demo.language`, else the demo settings'; the page's title
and text, where Obeya writes them, too), the overview in the repository's; a version keeps its date while its demo's own files stay the same (not the copies on the
site, which carry what Obeya adds to an artifact). The guard against a directory lacking pages
Obeya has as shared, and the file limit, refuse before anything is deployed. Which pages a change to
Obeya's templates leaves outdated says the list of page changes (see Outdated pages).

Each page names who shared it, under its title („Geteilt von Ada Lovelace am 20. Oktober 2026“,
"Shared by Ada Lovelace on October 20, 2026"), and the overview names them after the date („von Ada
Lovelace“): several colleagues publish to one site, each from their own Obeya. The name is git's
(`user.name` in the card's repository, which the setup asks for as the name for commits), read when
the page goes out (`by` in `meta.json`); a machine whose git has none leaves the name out. Pages
published before (until 2026-10-20) name nobody until they are shared again (change
`2026-10-20-by`). Rejected: a name of its own in Obeya's settings (one more thing to fill in for the
name the agents already commit under) and the machine's host name the manifest keeps (it names a
computer, not a person).

A machine without the site's `env` file has no target there: "Teilen" exports, with a line under the
buttons naming the file („Zum Veröffentlichen auf demos.example.dev braucht dieser Rechner
sites/demos/deploy.env.“); placed later, it counts when the owner next comes back to the page. A
site without `env` deploys with the machine's own login. A host that cannot take a whole directory
is not supported (see Decisions).

#### Several machines on one site

Several machines may publish to one site: each deploy is a full snapshot of one machine's directory,
so a machine deploying only its own pages would take the others' offline. Obeya therefore pulls
before it pushes. The site carries a manifest at its root, `obeya-site.json`: every page with its
`meta.json`, its files with size and hash, a revision and the machine (host name) that wrote it; a
withdrawn page stays listed as a tombstone with its date, so a machine that still has its files does
not bring it back. Only the machine whose card a page is changes it (slugs carry the card's id), so
its revision just counts up.

Before every publish or withdrawal Obeya reads the live manifest (with the site's `headers`, their
`${KEY}` values from the env file, since a site may sit behind a login), downloads the pages missing
here or newer there (checked against size and hash; the first share of a new machine downloads the
whole site, with a line in the card's log every 25 pages; a redirect within the site is followed,
since Cloudflare Pages answers `…/index.html` with a 308 to `…/`, while a redirect elsewhere is a
login), removes the pages withdrawn there, keeps the pages the live site lacks (its own, not
deployed yet or lost to a deploy in between), then writes its page, the overview and the manifest,
and deploys. Each manifest names its deployment. Right before the deploy Obeya reads the manifest
once more: another machine's deployment since the pull would be lost, so the round starts over.
After the deploy it reads the manifest again, for about 30 s while the site still serves the
deployment before (the deploy counts, with a line saying the site does not show it yet, if it never
does). Another machine's deployment that came in between without the change undoes it here and makes
it once more; a second one fails the share with a line in the card's log and leaves the card as it
was.

A deployment that lands after this machine's check, from a machine that pulled before it, still
takes its page offline (a static host has no compare-and-swap): the once-a-minute check when the
owner comes back also looks for the pages shared from here that the live site lacks or has older,
and deploys again (pull, then push), with a line on each of their cards; the next share from this
machine brings them back as well. Until then, or while this machine is off, the page is offline.

A manifest that cannot be read (network, a login, not a manifest) refuses the deploy, since
deploying blind could take pages offline; a site with no manifest at its URL (404) is the first
deploy. A host may answer every missing file with a page of its own and HTTP 200 (Cloudflare Pages
serves the overview for a site without a `404.html`): a manifest answered with the same page as a
file that cannot be there counts as missing, not as unreadable. A page another machine withdrew
costs its card here the link, with a line naming the machine: noticed with the next share to that
site or the once-a-minute check when the owner comes back. The guard against a directory lacking
pages Obeya has as shared stays as the last check after the pull.

### Decisions

- **Sharing belongs to a demo version** (owner, 2026-10-16). Until then a card shared one demo: a
  newer one offered "Neu teilen", which replaced the page, so a short demo that only corrected one
  detail could not stand beside the one it corrected. Now one page per card holds the versions the
  owner shares (see Several versions on one page); the worker says whether a later demo replaces or
  supplements, and the owner clicks.
- **"Teilen" sits on the demo's own line** (2026-10-14). Until then sharing came under the chapters
  and a dividing line, a button as wide as the column: with many chapters, or under a tall artifact,
  it was out of sight on opening, and it sat right on top of what followed.
- **A shared artifact's pages load no file beside them** (2026-10-20). Until then images,
  stylesheets and classic scripts stayed files beside the page, which load without CORS: in Firefox
  a colleague saw only the images' alt texts on a page behind Cloudflare Access, as Firefox sent
  the frame's requests for them without the login's cookie and the login answered with its page.
  Giving the frame `allow-same-origin` would have let the artifact's scripts read every other page
  of the site with the viewer's cookie; having the page around it fetch the files and hand them to
  the frame would have left the artifact's markup without its images until a script of the copy
  put them in.
- **A shared artifact's copy loads nothing in CORS mode** (2026-10-16). Until then a shared page
  showed an artifact whose module script, fetched JSON or font did not load: the site, behind
  Cloudflare Access, answered the frame's cookieless requests with its login page, and a ZIP from
  disk loads none. Giving the frame `allow-same-origin` would have let the artifact's scripts read
  every other page of a site behind a login with the viewer's cookie; asking the page around it
  for the files works on a site but not from disk. Opened from disk, a ZIP's page showed not even
  the artifact's stylesheets and images (Chrome loads nothing beside a sandboxed page there); its
  frame keeps the page's origin now, since a file on disk has no site to keep it from.
- **HTML artifacts are shared too** (2026-10-05): an analysis with charts is background for a pull
  request as much as a video.
- **Sharing takes effect at once.** Until 2026-10-02 it held 8 s with "Doch nicht"; withdrawing is
  just as easy.
- **Deploys run in `share/` under Obeya's home** (2026-10-05). Until then a share command ran in
  the checkout, which is often a workspace of the pool too, and the cache `wrangler pages deploy`
  leaves in its working directory kept that workspace from being leased after every share ("jeder
  freie hat nicht committete Änderungen").
- **A page is outdated by a change written down for its viewers, not by any difference in its
  bytes** (2026-10-16). Until then the version was a hash of sample pages: every template change
  marked pages outdated without saying what changed, also where nothing showed (a style the security
  fix added for artifact pages alone marked every video page), so the owner could not tell whether
  sharing 70 pages again was worth it, nor put the notice away.
- **Each outdated page is brought up to date on its own card** (2026-10-05): the first share command
  wrote every page afresh with each call, which updated all of them unseen and would take long with
  hundreds of pages.
- **A shared page speaks the demo's language** (2026-10-07). Until then the page was German
  throughout, an English demo's too.
- **Static sites are built into Obeya from a few lines of settings** (2026-10-09; in the adapter
  until 2026-10-15, its `deploy` an argv rather than a command line). Two other ways were
  considered and dropped (2026-10-08): a kit library each repository's own share script calls, which
  still leaves a script to maintain in every repository, and hosting providers built into Obeya,
  which puts provider code in the core where one deploy line covers them all.
- **The demo site is the only place "Teilen" publishes to** (2026-10-15). Until then a share command
  could stand in for it on a machine: a program of the repository's that got each page as JSON
  (`publish`, `withdraw <slug>`, `version`) and imported Obeya's page templates through `OBEYA_KIT`.
  It came first (2026-10-02), and once the site was built in, the two sat one below the other in the
  repository's settings with no visible connection, the command going first. No canvas used it any
  more, and every host that takes a directory fits the site's `deploy` line; a host that cannot take
  a whole directory is not supported. Should one be needed, a `deploy` script can upload what
  changed in `{dir}`.
- **Several machines on one site pull before they push** (2026-10-09). Two other guards were
  dropped: only refusing a deploy while the live manifest lists pages missing here, which left the
  owner nothing to do but copy files by hand, and a shared storage directory (a synced folder or a
  bucket) as the site's source, which pushes the problem onto every user's setup. Until 2026-10-09
  the first share of a second machine failed on Cloudflare's redirect.
