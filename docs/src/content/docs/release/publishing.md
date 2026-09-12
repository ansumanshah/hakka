---
title: Publishing to npm
description: Build, verify and publish Hakka's seven npm packages in dependency order.
---

Use this runbook with the [Release Checklist](/release/checklist/), which also
covers Android Maven, iOS SPM, and the macOS app. Run checks against the exact
commit and version you will publish; earlier successful runs do not validate
later changes.

## 1. Choose and align the release version

```bash
bun run changeset status
just version-audit
git tag --list
```

The seven npm packages form one Changesets fixed group. To consume pending
changesets, run `bun run version-packages`, then align the native versions and
source version constants reported by `just version-audit`. Changesets does not
update Android, iOS, or `apps/hakka/version.env`.

The first coordinated publication is prepared as **0.1.1**. Keep the existing
`v0.1.0` source tag unchanged. The pending package-content changeset is included
in the root changelog for 0.1.1.

Check existing tags before choosing a version. The SDK audit checks npm, Android,
iOS podspecs, source constants, and documented Maven coordinates. It does not
check the macOS version or tag targets. Confirm those separately and keep
existing published tags pointing at their original commits.

## 2. Verify the release commit

Commit the intended source changes and run from a clean checkout:

```bash
git status --porcelain
bun install --frozen-lockfile
bun run build
bun run phase:verify:ci
just version-audit
bun run docs:build
bun run pack:npm:dry-run
just smoke-tarballs
```

`pack:npm:dry-run` checks package contents. `smoke-tarballs` builds and packs the
publishable packages, installs them in a fresh consumer outside the workspace,
and exercises their entrypoints under Bun and Node. Keep its complete result
matrix with the release evidence, including the CLI and MCP checks.

The bare React Native entry is expected to skip execution outside Metro because
React Native contains Flow syntax. The separate Metro check exercises its
bundled entry. Neither replaces native app launch and capture checks.

The RN package also requires a device/simulator XCFramework matching its sources.
The npm release workflow builds and verifies it. For a local release, run
`bash scripts/build-rn-ios-xcframework.sh` and
`node scripts/verify-rn-ios-xcframework.mjs` before packing. See
[Prebuilt iOS SDK](/react-native/package/#prebuilt-ios-sdk) for consumer behavior.

## 3. Establish the release tag, then publish dependencies

All release workflows must select the same verified commit and version. Start
with `release-ios.yml`: after its Swift build, tests and podspec validation, it
creates `vVERSION` at the selected commit and the shared GitHub Release. An
existing tag is accepted only when it already points at that commit.

Next run `release-android.yml` and wait for all six matching Maven Central
coordinates to resolve. Then run `release-npm.yml`. Android, npm and desktop
workflows require the shared tag to exist at their selected commit; none moves
an existing tag. Configure the credentials named in each workflow before
dispatch. These are publishing actions, not dry runs.

The npm workflow publishes in this order:

1. `hakka-core`
2. `hakka-bridge`
3. `hakka-browser`
4. `hakka-node`
5. `hakka-react-native`
6. `hakka-rozenite`
7. `hakka-cli`

Internal dependencies use exact version pins, so earlier packages must resolve
before their dependents are installed.

After the release checks pass, dispatch the
[`release-npm.yml` workflow](https://github.com/ansumanshah/hakka/blob/main/.github/workflows/release-npm.yml)
with the chosen version and verified commit or branch:

```bash
gh workflow run release-npm.yml --ref <verified-ref> -f version=<release-version>
```

This command publishes packages. The workflow builds the iOS binary, checks
versions, builds and tests the packages, previews tarballs, checks Maven Central,
and publishes using `NPM_TOKEN` with provenance. Configure the token and verify
the local consumer smoke first; the workflow does not run `smoke-tarballs`.

Confirm each exact version is available after the workflow finishes:

```bash
for pkg in hakka-core hakka-bridge hakka-browser hakka-node hakka-react-native hakka-rozenite hakka-cli; do
  npm view "$pkg@<release-version>" version
done
```

Already published npm versions are skipped on a rerun only after a successful
registry lookup confirms the exact version. Other registry errors stop the job.

Then install the published packages in a fresh consumer and repeat the relevant
runtime checks. A local tarball pass does not prove registry installation.

Finally run `release-desktop.yml` for the same commit and version. It attaches
the signed, notarized macOS archive to the existing GitHub Release. Verify the
archive on another Mac before announcing desktop availability. Deploy the docs
and confirm their public URLs before sharing installation instructions.

## Correcting a bad release

Publish a fixed version, then deprecate the affected version with a short reason:

```bash
npm deprecate 'hakka-node@<affected-version>' 'Use <fixed-version> instead.'
```

Keep released versions available for existing lockfiles. Do not use unpublishing
as a way to replace an already published version. The CLI package is `hakka-cli`;
its executable is `hakka`.
