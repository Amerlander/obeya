# First setup on Windows: feedback from the user test

> Plan doc for what a user test of the Windows installer showed about the first setup. Deleted
> when it ships; durable content moves into [`docs/design.md`](../design.md).

## Goal

A first-time user on Windows (the exe installer) gets from installation to a working canvas
without help, in a folder that is not a git repository yet and in a repository that exists only on
this machine too. The repository's settings that are values (its main branch, how work lands, its
checks) can be seen and changed in the configuration dialog, without writing TypeScript and
without a restart.

## Where it stands

- *A folder without git.* The first canvas and "+ Repository" offer to set git up there, with a
  preview of the first commit (W2).
- *Main branch.* Detected by one function, `defaultBranch()` (`src/server/workspaces.ts`; W3), and
  shown in the first setup. It cannot be set anywhere yet (W5).
- *Landing.* Detected from the remote where the adapter does not say (W4): `pr` on GitHub, else
  `main`. It cannot be set anywhere but in the adapter yet (W5).
- *Settings as code.* `land`, `direct`, `checks`, `setup`, `planDocs`, `softPaths`, `workspaces`,
  `prNoise` and the demo's `howToRun` and `required` can only be set in `.obeya/adapter/index.ts`:
  TypeScript, loaded from the default branch, whose change restarts Obeya (`adapterChanged` in
  `src/server/main.ts`). Saving the configuration dialog (`canvases.json`) restarts Obeya too.

## Design

### Setting up git in a folder

Where the first canvas (or "+ Repository" in the configuration) is given a folder without git, it
offers "Hier ein git-Repository einrichten". That runs `git init` on git's `init.defaultBranch`,
else `main`. Before the first commit Obeya shows what goes in: the files with their sizes, large
ones marked, and a default `.gitignore` for build output, dependencies and secrets
(`node_modules/`, `dist/`, `.env*`, keys) that Obeya writes where the folder has none. The owner
confirms, and every file not ignored goes into the first commit, since workers only see committed
files. The commit's name and e-mail are the ones from the setup assistant's step for them.

### Main branch and landing by detection

The main branch is `origin/HEAD` where there is one, else the only local branch, else a local
branch named as `init.defaultBranch`, `main` or `master`, else the checkout's current branch, else
`init.defaultBranch` (cards' branches never count). The usual names come before the current branch
so that checking out another branch for a while does not move where work lands. One function
replaced the two that fell back to `main`. Without a GitHub remote (no `origin`, or one neither on github.com nor on a host `gh`
is logged into) the landing defaults to `main`; with one it stays `pr`. A setting (below) wins
over detection.

### Settings as data

Every adapter field that is a value gets a form in the configuration dialog, per repository: main
branch, `land`, `direct`, `checks`, `setup`, `planDocs`, `softPaths`, `workspaces`, `prNoise`, the
demo's `howToRun` and `required`.

- A change in the dialog applies to this machine at once. It is stored in the repository's entry
  in `canvases.json` and read where it is used, with no restart. Saving these values restarts
  nothing; other configuration changes (adding a canvas, say) restart as they do today.
- "Für alle ins Repository übernehmen" beside the form writes the values to `.obeya/settings.json`
  (like `.vscode/settings.json`), which a fresh clone brings with it. It is read from the default
  branch like the adapter, and a new version of it takes effect without a restart. Where work lands
  directly, Obeya commits the file to the main branch; where it goes through pull requests, the
  commit goes out as one.
- Precedence, highest first: this machine's values, `.obeya/settings.json`, the adapter's code,
  detection, the generic adapter. The dialog shows where each value comes from.
- `.obeya/adapter/` stays for what is code (`stack`, `share`, `canvasId` functions), and only a
  change to it restarts Obeya. The adapter skill writes value fields to `settings.json`.

## Workstreams

- [x] **W1:** Setup assistant fixes. Every recheck on Windows reads `PATH` from the registry again,
  not only after Obeya's own installations. uv moves above Whisper, and Whisper's "Installieren"
  waits until uv is there and says so. The folder/clone choice gets a new design; the worker picks
  one of the two variants the owner saw and shows it in the demo: choice cards ("Wo liegt dein
  Projekt?": "Schon auf diesem Rechner" / "Auf GitHub / einem Server", each a card with a radio
  button, the path field below) or one field that takes a path or a repository and says what it
  recognised ("Erkannt: Repository auf GitHub. Wird geklont nach …"). Independent of the rest.
  Done when git installed by hand on Windows turns "ok" as soon as the window gets the focus back.
- [x] **W2:** Set up git in a folder that has none. See Setting up git in a folder; on the first
  canvas and at "+ Repository" in the configuration. Done when a folder with a `node_modules/` and
  an `.env` becomes a canvas whose first commit holds neither, after the owner saw the preview.
- [x] **W3:** Recognise the main branch. See Main branch and landing by detection. One function
  for both callers; the first setup shows the branch it found. Done when a local repository on
  `master` without a remote gets worktrees, plan docs and landings on `master`.
- [x] **W4:** Landing follows the remote. See Main branch and landing by detection. Done when
  approving a card in a repository without a remote lands it on the main branch, and a repository
  with a GitHub remote still goes through pull requests.
- [ ] **W5:** Repository settings in the dialog, for this machine. See Settings as data: the form,
  the values in `canvases.json` read on use, no restart for saving them, the source of each value
  shown. Main branch and landing become changeable here. Done when switching a repository's landing
  from `pr` to `main` in the dialog applies to the next approval without a restart.
- [ ] **W6:** Settings for everyone in `.obeya/settings.json`. See Settings as data: reading it
  from the default branch without a restart, its place in the precedence, the button that commits
  it (directly or as a pull request), the adapter skill writing value fields there,
  `docs/adapter.md` and `docs/design.md` (Repo adapter, Configuration) updated. Done when a fresh
  clone of a repository whose settings were taken over for everyone runs with them, and the dialog
  says they come from the repository.

W1 and W2 can start at once; W3 and W4 do not depend on W5. W6 needs W5.

## Open questions

None.
