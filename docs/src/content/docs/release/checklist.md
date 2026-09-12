---
title: Release Checklist
description: The public release handoff for Hakka.
---

Use this checklist before publishing Hakka packages.

## Pre-Release Truth

- [ ] Release version selected and pending changesets consumed with `bun run version-packages`, or explicitly deferred for the first publish. All 7 npm packages and internal pins agree. Per-package changelog generation is disabled in `.changeset/config.json`.
- [ ] Native versions bumped to match: `android/**/build.gradle.kts`, `ios/Hakka.podspec`, and the iOS git tag.
- [ ] `just version-audit` passes (verifies all 7 JS packages + internal pins + Android Gradle + iOS podspec all agree).
- [ ] Existing tag targets reviewed; the new release tag identifies the verified commit. macOS `apps/hakka/version.env` is checked separately from the SDK version audit.
- [ ] `CHANGELOG.md` (root) has the release highlights and planned version.
- [ ] `bun outdated` is clean, or intentionally deferred versions are documented.

## Package Contents

- Every npm package (`hakka-core`, `hakka-browser`, `hakka-bridge`,
  `hakka-rozenite`, `hakka-react-native`, `hakka-node`, `hakka-cli`) ships its own
  `LICENSE` and `README.md` and a clean `files` array.
- `hakka-react-native` also includes `app.plugin.js` and `docs/EXPO.md`.
- Each package's `dist/` was rebuilt after the final source change (`bun run build`).
- `just smoke-tarballs` verifies fresh consumer installs under Bun and Node; the RN package includes its matching device/simulator XCFramework.
- Android Maven artifacts are published before any npm package that depends on
  them resolves.
- iOS podspec / Swift products match the release version and the SPM tag exists.
- optional UI and performance packages remain explicit.

## Open Source Boundary

No local agent state, ignored benchmark artifacts, internal notes, or secrets
should be committed:

```bash
git ls-files '.agent/**' '.agents/**' '.claude/**' '.codex/**' '.stitch/**' '.references/**' '.ramen/**' '**/.ramen/**' 'artifacts/**' 'CLAUDE.md'
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
just version-audit
bun audit --audit-level high
bun run build
bun run phase:verify:full
bun run docs:build
bun run pack:npm:dry-run
just smoke-tarballs
```

The docs build must include HTML pages, sitemap, search index, favicon, and
agent-readable `/llms.txt`, `/llms-full.txt`, `/llms-small.txt`, plus the
focused React Native/native SDK text subsets.

The full verification gate covers automated builds, tests, and local smoke checks.
Physical-device benchmarks require their own device runs and retained measurements.

## Runtime Evidence

- [ ] Bare RN iOS harness launches and captures a request.
- [ ] Bare RN Android harness launches and captures a request.
- [ ] Expo development-build path is documented; Expo Go is explicitly not supported because Hakka ships native code.
- [ ] Physical Android/iOS benchmark status is reported as verified or still open with exact blocker details.

## Mac App (Hakka for macOS)

- [ ] `apps/hakka/version.env` updated: `MARKETING_VERSION` matches the release and `BUILD_NUMBER` identifies the new build.
- [ ] `apps/hakka/Scripts/sign-and-notarize.sh` completes: universal build, Developer ID signature with hardened runtime, notarization accepted, ticket stapled.
- [ ] `spctl -a -t exec -vv Hakka.app` passes on the stapled bundle.
- [ ] The zip opens on a machine that is not the build machine (quarantine flag intact) without right-click gymnastics.
- [ ] macOS floor stated in release notes: 15+ (ADR 0012).

## Release Order

Publish in dependency order so each package's pinned deps resolve:

1. `release-ios.yml`: build/test Swift, create the shared `vVERSION` tag at the verified commit and the GitHub Release.
2. `release-android.yml`: publish all six Maven artifacts; wait for their exact coordinates to resolve.
3. `release-npm.yml`: publish `hakka-core` → `hakka-bridge` → `hakka-browser` → `hakka-node` → `hakka-react-native` → `hakka-rozenite` → `hakka-cli`.
4. Install the published versions in fresh consumers and verify capture, redaction, export and the documented entrypoints.
5. `release-desktop.yml`: attach the signed, notarized macOS archive to the same release; verify a quarantined download on another Mac.
6. Publish the docs website, check its public links, then announce the verified artifacts.

Every workflow selects the same commit. Existing tags cannot be moved by these
workflows. Keep incomplete platform releases clearly marked in release notes.
