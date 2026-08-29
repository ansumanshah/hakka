---
title: Release Checklist
description: The public release handoff for Hakka.
---

Use this checklist before publishing Hakka packages.

## Pre-Release Truth

- [ ] `bun run version-packages` applied the pending changesets — all 7 npm packages (a fixed group) bumped to the same version, internal pins and per-package `CHANGELOG.md` updated.
- [ ] Native versions bumped to match: `android/**/build.gradle.kts`, `ios/Hakka.podspec`, and the iOS git tag.
- [ ] `just version-audit` passes (verifies all 7 JS packages + internal pins + Android Gradle + iOS podspec all agree).
- [ ] `CHANGELOG.md` (root) has the release highlights and planned version.
- [ ] `bun outdated` is clean, or intentionally deferred versions are documented.

## Package Contents

- Every npm package (`hakka-core`, `hakka-browser`, `hakka-bridge`,
  `hakka-rozenite`, `hakka-react-native`, `hakka-node`, `hakka-cli`) ships its own
  `LICENSE` and `README.md` and a clean `files` array.
- `hakka-react-native` also includes `app.plugin.js` and `docs/EXPO.md`.
- Each package's `dist/` was rebuilt after the final source change (run
  `bun run build` — consider a `prepublishOnly` per package to enforce this).
- Android Maven artifacts are published before any npm package that depends on
  them resolves.
- iOS podspec / Swift products match the release version and the SPM tag exists.
- optional UI and performance packages remain explicit.

## Open Source Boundary

No local agent state, ignored benchmark artifacts, internal notes, or secrets
should be committed:

```bash
git ls-files '.claude/**' '.codex/**' '.stitch/**' '.references/**' '.ramen/**' '**/.ramen/**' 'CLAUDE.md'
```

Sensitive wording scan (review for real findings, not test fixtures):

```bash
git grep -n -E 'secret|token|api[_-]?key|private launch|internal only|do not publish' \
  -- ':!**/*Test*' ':!**/__tests__/**'
```

Docs canonical host resolves before publish:

```bash
curl -I -L --max-time 10 https://hakka.noodleapps.com
```

## Validation

```bash
bun install --frozen-lockfile
bun run cleanup:check
just version-audit
bun audit --audit-level high
bun run typecheck
bun run build
bun run test
just build-android
bun run build:ios
bun run phase:verify:ci
bun run docs:build
bun run pack:npm:dry-run
```

The docs build must include HTML pages, sitemap, search index, favicon, and
agent-readable `/llms.txt`, `/llms-full.txt`, `/llms-small.txt`, plus the
focused React Native/native SDK text subsets.

Use `bun run phase:verify:full` before claiming physical benchmark completion.

## Runtime Evidence

- [ ] Bare RN iOS harness launches and captures a request.
- [ ] Bare RN Android harness launches and captures a request.
- [ ] Expo development-build path is documented; Expo Go is explicitly not supported because Hakka ships native code.
- [ ] Physical Android/iOS benchmark status is reported as verified or still open with exact blocker details.

## Mac App (Hakka for macOS)

- [ ] `version.env` bumped: `MARKETING_VERSION` matches the release, `BUILD_NUMBER` incremented (Apple rejects duplicate notarization uploads).
- [ ] `apps/hakka/Scripts/sign-and-notarize.sh` completes: universal build, Developer ID signature with hardened runtime, notarization accepted, ticket stapled.
- [ ] `spctl -a -t exec -vv Hakka.app` passes on the stapled bundle.
- [ ] The zip opens on a machine that is not the build machine (quarantine flag intact) without right-click gymnastics.
- [ ] macOS floor stated in release notes: 15+ (ADR 0012).

## Release Order

Publish in dependency order so each package's pinned deps resolve:

1. publish Android Maven artifacts and tag the iOS Swift Package
2. `hakka-core` → npm
3. `hakka-browser` → npm (depends on core)
4. `hakka-bridge` → npm
5. the leaf packages, after the above resolve: `hakka-react-native` (after Maven
   coordinates resolve), `hakka-node` (needs `hakka-bridge`), `hakka-rozenite`,
   and `hakka-cli` (CLI, needs `hakka-bridge` for its `/mcp` subpath)
6. publish docs website
