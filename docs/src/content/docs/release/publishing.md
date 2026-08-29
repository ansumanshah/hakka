---
title: Publishing to npm
description: The exact command sequence for Hakka's first npm release, what to check between steps, and how to roll back a bad publish.
---

None of the seven Hakka npm packages have ever been published. Every `npm install
hakka-core` / `npx hakka-cli` line in these docs is correct and today resolves to
nothing. This page is the runbook that closes that gap. Read
[Release Checklist](/release/checklist/) first for the full multi-platform
release (Android Maven, iOS SPM, the macOS app); this page is only the npm leg.

It does not publish anything itself. Every step below is either read-only or a
dry run until the explicit `npm publish` commands in
[Step 4](#step-4-publish-in-dependency-order).

## Step 0: pre-flight, already verified

These gates were run against the current tree and passed. Re-run them yourself
before you publish: code moves between when this page was written and when you
read it.

```bash
just version-audit    # all 7 package.json + internal pins + Android Gradle + iOS podspec agree
node scripts/spec-api-check.mjs   # every documented symbol actually resolves from its export
just smoke-tarballs   # packs all 7, installs the tarballs in a throwaway project, runs a hello-world per package under bun + node
```

`smoke-tarballs` is the one that matters most: `npm pack --dry-run` only proves
the file list is right, not that a fresh consumer can actually `import`/`require`
the package. Last real run:

```
Result matrix (package[:subpath check] | bun | node)
  hakka-core                       bun=PASS  node=PASS
  hakka-core (test)                bun=PASS  node=PASS
  hakka-bridge                     bun=PASS  node=PASS
  hakka-node                       bun=PASS  node=PASS
  hakka-node (next)                bun=PASS  node=PASS
  hakka-cli (cdp)                  bun=PASS  node=PASS
  hakka-react-native               bun=SKIP  node=SKIP
  hakka-browser                    bun=PASS  node=PASS
  hakka-browser (elements)         bun=PASS  node=PASS
  hakka-browser (react)            bun=PASS  node=PASS
  hakka-rozenite                   bun=PASS  node=PASS

smoke-tarball-install: PASS
```

The two `hakka-react-native SKIP` rows are expected, not a gap: its main entry
imports the real `react-native` package at module scope, and `react-native`
itself cannot be imported outside Metro/Babel (it uses Flow syntax node/bun
can't parse). The script verifies structurally instead: tarball extracted,
`lib/module/index.js` present, `hakka-core` resolves through the same
`overrides` every other package uses, and documents why inline.

Also check `bun changeset status`: it should list exactly the 7 fixed-group
packages (`hakka-core`, `hakka-browser`, `hakka-bridge`, `hakka-node`,
`hakka-react-native`, `hakka-rozenite`, `hakka-cli`) and nothing else. If a
private example workspace shows up in that list, `.changeset/config.json`'s
`ignore` array is missing its `name` field. Add it there, not by touching the
example itself.

## Step 1: decide the version

The tree currently sits at `0.1.0` with **no unconsumed changeset that changes
that number for a first release**: `.changeset/publish-ready-tarballs.md`
(added alongside this page) is a `patch` covering a tarball-contents fix in
`hakka-browser`, which the fixed group carries to all 7 packages.

This is a real fork, not a formality: pick one:

- **Ship `0.1.0` as the first release, defer the changeset.** Simplest: the
  version already in every `package.json` is what publishes. Do this if you
  want the very first tag to be a round number. The changeset stays pending
  and rolls into whatever the _next_ release is.
- **Consume the changeset first, ship `0.1.1`.** Run `bun run version-packages`
  before Step 2; it bumps all 7 `package.json` files + internal pins to
  `0.1.1` and deletes the changeset file. Do this if you'd rather the first
  published version already include the tarball-contents fix.

Either is safe; nothing below depends on which you pick. If you bump, re-run
`just version-audit` afterward: the native versions (`android/**/build.gradle.kts`,
`ios/Hakka.podspec`, the iOS git tag) need a matching manual bump, since
changesets only tracks the JS side.

## Step 2: build once, from a clean tree

```bash
git status --porcelain   # must be empty; a stray file changes what npm pack picks up
bun install --frozen-lockfile
bun run build             # rebuilds all 7 packages' dist/ in dependency order
bun run test
```

## Step 3: re-verify the tarballs at the version you're about to ship

```bash
just version-audit
bun run pack:npm:dry-run   # every packages/*/, private hakka-bench included harmlessly (pack --dry-run, not publish)
just smoke-tarballs
```

If any of these fail, stop: fix it, commit, and restart Step 2. Do not publish
a package whose smoke check didn't run at the exact version you're about to tag.

## Step 4: publish, in dependency order

Publish order matters because each package's `dependencies` pin an **exact**
internal version (`"hakka-core": "0.1.0"`, not a range): a dependent published
before its dependency exists on the registry will resolve to nothing for
anyone who installs it in that window.

```bash
npm whoami   # confirm you're authenticated as the right account before anything below

for pkg in hakka-core hakka-bridge hakka-browser hakka-node hakka-react-native hakka-rozenite hakka-cli; do
  echo "=== publishing $pkg ==="
  (cd "packages/$pkg" && npm publish --access public --provenance)
  echo "=== verifying $pkg landed ==="
  npm view "$pkg" version
done
```

Why this order:

- `hakka-core` has no internal deps, so it publishes first.
- `hakka-bridge` and `hakka-browser` depend only on `hakka-core`.
- `hakka-node` depends on `hakka-core` + `hakka-bridge` (`hakka-browser` is an
  optional peer, only for its `./next/client` entry, so it doesn't block ordering).
- `hakka-react-native` depends on `hakka-core`. It also needs the Android Maven
  coordinates (`com.noodleapps.hakka:hakka-network:<version>` etc.) and the iOS
  SPM tag published first: see the Release Checklist's Maven-artifact-published
  check. If those aren't up yet, publish this package last, not third.
- `hakka-rozenite` depends on `hakka-core` + `hakka-browser` (`hakka-react-native`
  is a peer, so it doesn't block ordering here).
- `hakka-cli` depends on `hakka-core` + `hakka-bridge` + `hakka-node`, so it
  publishes last.

Between each `npm publish`, the `npm view <pkg> version` line above is the
check: it queries the real registry, so it also confirms the previous
package's publish is actually visible before the next one's install-time
resolution needs it (registry propagation is normally instant, but don't chain
publishes faster than you can read the output).

`--provenance` requires publishing from CI with OIDC (GitHub Actions'
`id-token: write` permission), not a local machine. Omit it for a manual
publish from your laptop, or use the GitHub Action once it's fixed (see below).

### The GitHub Action needs a one-line fix first

`.github/workflows/release-npm.yml` is the intended "single command" path
(`gh workflow run release-npm.yml -f version=0.1.0`) and does everything Steps
2–4 do, plus the Android Maven-artifact-published check and `--provenance`.
**As committed right now it will fail on the last package**: its publish loop
still lists the directory as `hakka`,

```yaml
for pkg in \
hakka-core \
hakka-bridge \
hakka-browser \
hakka-node \
hakka-react-native \
hakka-rozenite \
hakka # <- stale; the directory is packages/hakka-cli
```

left over from before the CLI package's directory was renamed
`packages/hakka` → `packages/hakka-cli` (the bare `hakka` name is
permanently blocked on npm, see below, so the package itself is
`hakka-cli`, only its `bin` is still `hakka`). `cd packages/hakka` will error
with no such directory. Fix that one line to `hakka-cli` before dispatching
this workflow; this file wasn't in scope for this pass to edit directly.

## Rolling back a bad publish

**Use `npm deprecate`, never `npm unpublish`.**

```bash
npm deprecate hakka-node@0.1.0 "Broken next/server export, use 0.1.1"
```

This leaves `0.1.0` installable (so nobody's lockfile breaks) but prints a
warning on every install and in `npm audit`/`npm outdated` output, steering
people to the fixed version you publish right after. Cut the fix as a normal
new version through Steps 1–4: `0.1.1`, not a republish of `0.1.0`.

`npm unpublish` doesn't just remove your release: it forfeits the name's
history. A later attempt to reuse that name is treated as a brand-new claim,
which npm's automated anti-typosquat filter can reject outright. That's
exactly what happened to the original bare `hakka` package: published in
September 2024, unpublished in October 2024. A real, authenticated
`npm publish hakka` attempt in August 2026 came back `403 Package name too
similar to existing package hasha`. The name is gone permanently, not
because anyone squatted it, but because unpublishing reset it to "new," and
"new" collided with an existing popular package's similarity radius. There is
no support ticket that reverses this once the filter has rejected it; `hasha`
is too established for an override. It's the reason the CLI ships as
`hakka-cli` today instead of bare `hakka`.

If a publish is actively harmful (leaked secret, broken install for
everyone) and deprecation isn't fast enough, npm does allow unpublishing
within a short window after publish with no other packages depending on the
version yet, but treat that as a last resort for the current version only,
never as a way to "undo and retry" a name or version you might want back.
