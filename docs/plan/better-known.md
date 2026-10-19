# Making Obeya better known

> Plan doc for bringing Obeya to Claude Code users worldwide and to tech leads and teams in
> Germany: demo sites that point back to Obeya and carry a feed, a weekly post drafted from the
> week's demos, and a launch kit. Deleted when it ships; durable content moves into
> [`docs/design.md`](../design.md).

## Goal

Obeya is known to Claude Code users worldwide and to tech leads and teams in Germany, so that more
of them install it, star it, and come back with issues and contributions. The owner gives one
launch day, a post now and then, and a weekly post; agents prepare everything else.

## Where it stands

Checked 2026-10-19.

- *Repository*: public since 2026-10-05; 8 stars, 23 unique visitors in 14 days; referrers
  obeya.si, github.com, LinkedIn.
- *Reach so far*: the owner's LinkedIn post, obeya.si with the hero video (GitHub Pages, built
  from `site/`), demos.obeya.si with 31 public feature demos in English, releases 0.1 to 0.5 with
  signed Mac apps. Windows builds are not signed yet (`site/code-signing/` is the policy page for
  the SignPath Foundation application).
- *Demo sites*: `src/server/site.ts` writes every demo site Obeya keeps: one directory per page
  with its `index.html` and `meta.json`, and the overview at the root (`overviewHtml`), which lists
  each page with its date and the first sentence of its text. The pages come from the templates in
  `src/server/demo-page.ts`, in the page's language (`PAGE_WORDS`, German and English). Neither
  the pages nor the overview say what made them, and there is no feed. A page keeps the template it
  was published with; a change to the templates that viewers see gets an entry in
  `src/core/page-changes.ts`, and the Koordinator's sheet then offers to share the outdated pages
  again (see Outdated pages in `docs/design.md`).
- *Elsewhere*: Obeya is not on Hacker News, Reddit, Product Hunt or any awesome list.
  awesome-claude-code (56k stars) takes recommendations only through its web issue form, from
  projects at least 14 days old with ongoing commits or with 100 stars, and says plainly that it is
  no launch channel: users first, then the list.
- *Skills in this repository*: `.claude/skills/release/` is the only one.
- *The repository page* (homepage URL, topics, social preview, a clip at the top of the README) is
  being built as the task “GitHub page that gets found”.

## Design

### Decisions

- Three workstreams, each a card of its own: demo sites that point back to Obeya, the weekly post,
  the launch kit.
- The credit line goes on every demo site Obeya generates, with no setting to turn it off: settings
  stay few, and a static credit line is common practice. It is in the page's language like the
  rest of the page („Aufgenommen mit Obeya“ on a German site).
- Nothing about Obeya goes into pull requests or commits of other repositories: it would read as
  advertising there.
- The owner posts everything; no agent posts, submits or comments anywhere.
- The awesome-claude-code recommendation goes in a week or two after the launch, once the launch
  has brought users. Product Hunt only if the launch goes well.
- Dropped: talks, YouTube reviewers and community showcases, since they take more of the owner's
  time than chosen.

### Demo sites point back to Obeya

- Every page and the overview end in a small footer line "Recorded with Obeya" linking
  https://obeya.si (a word in `PAGE_WORDS` for each language).
- Each site gets an Atom feed, `feed.xml` at its root, written with the overview from the same
  pages (`readPages`): one entry per page, the newest first, with the page's title, its text, its
  absolute URL (`pageUrl`) as link and id, and the date the overview shows (`newest`) as updated.
  The overview links it, visibly and with `<link rel="alternate" type="application/atom+xml">`.
  Since every share writes the overview and deploys the whole directory, the feed is always as
  current as the overview, and a page pulled from another machine shows in it too.
- The footer is a page change: it gets its entry in `page-changes.ts`, so the outdated pages can be
  shared again from the Koordinator's sheet. For demos.obeya.si the worker shares all 31 again
  once the change has landed, so the footer is on every public page.

### Weekly post

- A skill `.claude/skills/weekly-post/` beside `release`, which the owner starts with „Schreib den
  Wochenpost“ (also "write the weekly post").
- It reads the demos of the past seven days from `https://demos.obeya.si/feed.xml`; until that
  exists, from the overview page's dates and links.
- It picks the three to five changes a user would care about and drafts a short LinkedIn post in
  English, in the owner's first person, each change in a sentence with the link to its demo page.
  The repository is written as github.com/sadilek/obeya, without https://.
- It downloads the `demo.mp4` of the demo that shows the week best, for the owner to attach.
- Draft and clip go to `~/demos/weekly-post-<date>/` (`post.md` and the video), outside git. It
  posts nothing. A week without demos gets no draft, only a line saying so.

### Launch kit

- An essay on obeya.si with the thesis "Stop testing your agents' work: watch the demo", as a page
  of its own under `site/` in the site's style, linked from the navigation and the footer of
  `site/index.html`.
- Drafts for the owner, outside git: the Show HN title and first comment, an r/ClaudeAI post, a
  LinkedIn launch post, and the text for the awesome-claude-code issue form. Each names Windows
  builds as not yet signed. The worker hands them over as an HTML artifact, every draft in a block
  of its own to copy.
- The owner posts HN, Reddit and LinkedIn on one day and answers the comments; the awesome-list
  recommendation goes in a week or two later.

### Order

W1 and W2 can land in either order: W2 reads the overview page until W1's feed is there. W3 waits
for the task “GitHub page that gets found” to land, since every post leads to the repository page.

### The owner's part

Reading the drafts, the launch day, ten minutes a week for the post.

## Workstreams

- [x] **W1:** Demo sites point back to Obeya. A footer line "Recorded with Obeya" (in the page's
  language, through `PAGE_WORDS`) linking https://obeya.si on the overview and on every page
  `src/server/demo-page.ts` and `src/server/site.ts` write; an entry in `src/core/page-changes.ts`
  and the new `PAGES_HASH`. An Atom feed `feed.xml` at each site's root, written with the overview
  from the same pages (title, text, absolute page URL, date), linked from the overview visibly and
  with `<link rel="alternate">`. Tests in `site.test.ts` for the footer and the feed (valid Atom,
  newest first, absolute links, escaping). Once landed, the 31 pages of demos.obeya.si shared again
  from the Koordinator's sheet. `docs/design.md` updated.
- [ ] **W2:** Weekly post from the demos. A skill `.claude/skills/weekly-post/` started with
  „Schreib den Wochenpost“: reads the past seven days' demos from demos.obeya.si's `feed.xml`, or
  its overview page until the feed exists; picks the three to five changes a user would care
  about; drafts a short LinkedIn post in English in the owner's first person, with the demo links
  and github.com/sadilek/obeya written without https://; downloads the `demo.mp4` that shows the
  week best. Writes `post.md` and the clip to `~/demos/weekly-post-<date>/`, posts nothing; a week
  without demos gets no draft. Tried once on the past week, the draft shown to the owner.
- [x] **W3:** Launch kit. Waits for the task “GitHub page that gets found”. An essay page on
  obeya.si under `site/` with the thesis "Stop testing your agents' work: watch the demo", linked
  from the navigation and footer of `site/index.html`. Drafts, outside git and handed over as an
  HTML artifact: the Show HN title and first comment, an r/ClaudeAI post, a LinkedIn launch post,
  and the text for the awesome-claude-code issue form, each naming Windows builds as not yet signed.

## Risks

- **One shot on Hacker News.** A Show HN that sinks unseen is hard to repeat; the day and hour are
  the owner's choice, and the first comment has to stand on its own for readers who do not click.
- **Unsigned Windows builds.** SmartScreen warns on the installer; saying so in every post keeps
  it from reading as hidden, but Windows users may still drop off until the signing is there.
- **Credit line on login-protected sites.** A site behind a login shows the line only to those who
  can open it, and its feed cannot be read by a feed reader without the login; it costs nothing
  there and helps only on public sites.

## Open questions

- None.
