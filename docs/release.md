# Releasing Obeya

How a version of the app goes out, and the owner's steps it depends on. The builds are described
in `docs/design.md` (Builds, App updates).

The Mac apps are signed with a Developer ID and notarised; the Windows installer and the Linux
packages are not signed, and the release lists the SHA-256 of every file in `SHA256SUMS`.

## A release

Every release takes the site along: the hero video is rendered again from the Obeya being
released, and the site's screenshots are taken again with it. When the owner says "Mach ein
Release", the project skill `.claude/skills/release/SKILL.md` goes through these steps in this
order, on an Obeya card or in a terminal; it adds when to ask the owner and what to look at.
The scripts that talk to GitHub act on the checkout's origin as the account that owns it
(`sadilek` for sadilek/obeya, with its gh login, without switching the account gh has active);
other gh calls go through `bun scripts/gh.ts <gh args…>`, which does the same, since the
machine's active account may lack the admin rights a workflow run or a rerun needs.

1. Where things stand: `bun scripts/release-status.ts` prints the last version tag, the commits
   since then that change what runs (the release's notes will be their subjects), the version to
   propose (the next minor one while the version is 0.x), how far GitHub's `main` is behind, the
   latest release and whether `site-media` is still a pre-release, when the site's video went up
   next to the last commit to `src/ui`, and whether the build's secrets are there. It ends with what
   stands in the way and exits with 1 then. Two of its checks come from v0.1.0, where GitHub's
   `main` was 35 commits behind and `site-media` was the latest release.
2. The narration (`scripts/hero-video/narration.ts`), read against the UI being released: a
   sentence that no longer holds is reworded before the render. Every changed sentence costs
   ElevenLabs credits; the others come from the clip cache in the render's `.work/`, so the render
   goes to its default directory `~/demos/obeya-hero/`, not a new one.
3. The video, rendered whole from the release's code, with a real agent, about ten minutes
   (`scripts/hero-video/README.md`), and its stills checked for the three failures the README
   names. Then from the same render, in the release's checkout:
   - the site's screenshots, `bun scripts/site-shots.ts --demo <dir>` with the Tipjar demo the
     render's agent left (the newest `~/demos/tipjar-split-the-bill*` without `-two`), into
     `site/img/`: the desktop ones and the two of the phone view (`phone.png`, `phone-demo.png`);
   - the poster and the README's picture of the video, `node scripts/hero-video/publish.ts --poster-only`
     (it uploads nothing);
   - a copy of `demo.mp4`, `captions.vtt`, `chapters.vtt` and `review/` in `~/demos/obeya-v<version>/`,
     so that what goes out in step 8 is the video that was looked at, even if the hero video is
     rendered again meanwhile.
4. The version in `package.json` (the app, its settings and the release take it from there),
   committed with the poster, the README's picture and the screenshots. Landing it restarts a
   running Obeya (`package.json` counts as code).
5. `git push origin main`. The tag's commit has to be on GitHub, and the README and the site
   come from `main`.
6. `git tag v<version> <commit>` on the commit with the version, and `git push origin v<version>`:
   `git push` alone pushes no tag (v0.1.0's was pushed by hand later). The tag must be the version of `package.json`,
   else the run makes no release (its first check fails at once). The build workflow builds every platform, checks them, signs and
   notarises the Mac apps (Apple answers within a minute or so) and makes a draft release with the
   installers, the updates and their signatures, `SHA256SUMS`, `latest.json` and notes from the
   commits since the tag before. A run takes about ten minutes.
7. The run and the draft: the run of the build workflow for the tag (`bun scripts/gh.ts run list
   --workflow build.yml --branch v<version>`, then `bun scripts/gh.ts run watch <id>`; a job that
   failed on something flaky runs again with `bun scripts/gh.ts run rerun <id> --failed`), then
   `bun scripts/release-status.ts draft v<version>`, which checks that the draft holds every
   installer, update and signature, and a `latest.json` of the version that names every platform,
   and prints the notes. A run that fails on the Macs with HTTP 403 needs the owner to accept
   Apple's agreement (Signing the Mac apps).
8. The video: `HERO_OUT=~/demos/obeya-v<version> node scripts/hero-video/publish.ts` uploads it with
   its captions and chapters and runs the Pages workflow, which publishes the poster and the
   screenshots pushed in step 5 along with it.
9. The owner reads the draft and publishes it as the latest release ("Set as the latest release"
   stays ticked). Publishing reaches every installed app, so that click is the owner's. The README's
   and the site's download links go to the latest release; installed apps
   find it at their next start or within six hours, and offer it in their bar. The notes in
   `latest.json` (what the bar shows on hover) are the generated ones, whatever the release's text
   says after an edit. Afterwards `bun scripts/release-status.ts` names the new version as the
   latest release.

The release `site-media` holds the site's video (`scripts/hero-video/`), not a version: it is a
pre-release, so it never becomes the latest release, and its tag does not count as the tag before.

## The updater's key

Installed apps install only what is signed with Obeya's own key pair (Tauri's updater, made with
`tauri signer generate` on 2026-10-08, without a password).

- The public key is in `app/tauri.conf.json` (`plugins.updater.pubkey`); every app carries it.
- The private key is `~/.tauri/obeya.key` on the owner's Mac. Keep a copy in a password manager:
  without it no update reaches the apps that are installed, which would then have to install the
  next version by hand.
- The build workflow signs with the repository secret `TAURI_SIGNING_PRIVATE_KEY`, the file's
  content (`gh secret set TAURI_SIGNING_PRIVATE_KEY --repo sadilek/obeya < ~/.tauri/obeya.key`),
  read on tags only. Without it a release has no updates and `latest.json` names no platform.

A key that is lost or got out is replaced by a new pair whose public key goes into
`app/tauri.conf.json`; apps installed before still trust the old one, so the release with the
new key has to be installed by hand once (say so in its notes).

## Signing the Mac apps

The build signs and notarises them with four repository secrets (five with a team key) (Settings → Secrets and variables
→ Actions, or `gh secret set <NAME> --repo sadilek/obeya`, which reads the value from standard
input). A tag fails on the Macs while one is missing.

### Membership and agreement

The Developer ID needs a membership in the Apple Developer Program (99 USD a year). Apple's API
refuses notarisation ("A required agreement is missing or has expired", HTTP 403) until the
account holder has accepted the newest Program License Agreement: it shows as a banner on
<https://developer.apple.com/account> and in App Store Connect under Business. Apple renews it
now and then, and a release fails the same way until it is accepted again.

### The Developer ID Application certificate

1. Make it, if the keychain has none (`security find-identity -v -p codesigning` lists a
   "Developer ID Application: …"): in Xcode, Settings → Accounts → the team → Manage
   Certificates → + → Developer ID Application (only the account holder may), or on
   <https://developer.apple.com/account/resources/certificates> with a certificate signing
   request from Keychain Access (Certificate Assistant → Request a Certificate from a Certificate
   Authority, saved to disk).
2. Export it with its private key: Keychain Access → login → My Certificates → the
   "Developer ID Application: …" entry → Export → `.p12`, with a password. The `.p12` format is
   offered only for the certificate with its private key (the entry under My Certificates, the
   key folded under it); under Certificates it is greyed out. Exported from the key's row instead,
   the file holds the key without the certificate, and the build fails with "failed to resolve
   signing identity". `openssl pkcs12 -info -noout -in obeya.p12` lists what the file holds: a
   "Certificate bag" and a "Shrouded Keybag".
3. Secrets:
   - `APPLE_CERTIFICATE`: the `.p12` in base64, `base64 -i obeya.p12 | gh secret set APPLE_CERTIFICATE --repo sadilek/obeya`
   - `APPLE_CERTIFICATE_PASSWORD`: the export's password.
4. Delete the `.p12` file. The certificate is valid for five years; apps signed and notarised
   before it expires keep opening (the signature carries a timestamp). A new one goes into the
   two secrets the same way (`security find-certificate -c "Developer ID Application" -p | openssl x509 -noout -enddate`
   says when it ends).

### The App Store Connect API key, for notarisation

1. On <https://appstoreconnect.apple.com/access/integrations/api>: a team key (Team Keys → +,
   access "Developer"), or an individual key (Individual Keys, for the account's own user).
   Download the `.p8` (Apple offers it once) and note its key ID; for a team key also the Issuer
   ID above the list.
2. Secrets:
   - `APPLE_NOTARY_KEY`: the `.p8`'s contents, `gh secret set APPLE_NOTARY_KEY --repo sadilek/obeya < AuthKey_XXXXXXXXXX.p8`
   - `APPLE_NOTARY_KEY_ID`: the key ID.
   - `APPLE_NOTARY_ISSUER`: the Issuer ID, for a team key only.
3. Keep the `.p8` somewhere safe (`~/.appstoreconnect/private_keys/` is where Apple's tools look)
   or delete it; Apple does not offer it again, a lost one is revoked and replaced.

### Trying it before a release

Actions → Build → Run workflow, with "Sign and notarise the macOS app" ticked (or `bun scripts/gh.ts workflow run
build.yml --ref main -f sign=true`): the Macs build as on a tag (without a
release), and the step "The compiled server and the app around it" ends
with Gatekeeper's verdict, `source=Notarized Developer ID`. On a Mac, `bun run build:app` does the same with the certificate in the keychain:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
APPLE_NOTARY_KEY=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8 \
APPLE_NOTARY_KEY_ID=XXXXXXXXXX APPLE_NOTARY_ISSUER=<issuer, team key only> \
bun run build:app
```

## Windows and Linux

Not signed. SmartScreen warns about the Windows installer until it has a reputation ("More
info", then "Run anyway"), which the site and the README say; a certificate comes later
(SignPath Foundation, free for open-source projects, once a release with some reputation is
out). The release notes say how to check a download against `SHA256SUMS`.
