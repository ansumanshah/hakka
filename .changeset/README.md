# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). It coordinates versioning across Hakka's seven published npm packages.

## How releases work

All seven npm packages are a **fixed group** — they always move to the same version together (see `config.json`). Internal dependency pins (e.g. `hakka-browser` → `hakka-core`) are updated automatically when you version.

Changesets handles **versions only**, not changelogs: `config.json` sets `"changelog": false`, so `version-packages` does not scatter a per-package `CHANGELOG.md`. Hakka keeps one hand-written `CHANGELOG.md` at the repo root — add your entry there.

```bash
# 1. After making changes, describe them:
bun changeset
#    → pick the bump (patch/minor/major) and write a one-line summary.
#    Because the packages are a fixed group, one changeset bumps all seven.

# 2. When you're ready to cut a release, apply the changesets:
bun run version-packages
#    → bumps every package.json + internal pins, deletes the consumed changeset files.

# 3. Update the root CHANGELOG.md by hand — move the `Unreleased` section under
#    the new version heading.

# 4. Commit the result, then keep the native versions in lockstep:
just version-audit          # verifies JS + Android Gradle + iOS podspec/tag all agree
#    Bump android/**/build.gradle.kts, ios/Hakka.podspec, and the iOS git tag to the new version.

# 5. Publish:
#    - Android Maven artifacts and the iOS SPM tag first.
#    - Then dispatch the "Release npm" GitHub Action with the new version — it publishes all seven npm packages in dependency order with provenance.
```

Native (Android Gradle, iOS Swift/podspec) versions are **not** managed by changesets — `scripts/version-audit.mjs` is the gate that keeps them aligned with the JS packages.
