# Hakka agent guide

Hakka is a local-first network inspector across React Native, web, Node/Next.js,
Android, iOS, and the macOS app in `apps/hakka/`. Use Hakka naming in all public
code, docs, tests, and APIs. Verify release status rather than inferring it from
older launch notes.

## Essential constraints

- `hakka-core` is the shared, UI-less, dependency-light engine; the Hakka record
  contract (`RECORD_SCHEMA_VERSION`) is the cross-platform wire format.
- Android/iOS own capture, redaction, storage, export, and noop behavior. Runtime
  adapters add capture where native APIs cannot observe traffic. React Native
  supports native capture only; other shared-core modes are not RN capabilities.
- No default cloud upload. Redact sensitive headers before records reach stores,
  UI, exports, or desktop streaming. Interceptors capture raw facts quickly;
  processors filter, redact, map, store, and notify.
- `ios/Sources` is canonical. Never hand-edit
  `packages/hakka-react-native/ios/Core`; regenerate with `just sync-ios`.
  `design-tokens.json` is canonical for colors; regenerate with `just sync-tokens`.
- Do not upgrade Android AGP/Gradle past the deliberately deferred baseline
  without a decision. Read Android Notes in the reference before toolchain work.
- Use behavioral tests, avoid duplicate core coverage and tautologies, and leave
  benchmarks untouched. Read the reference's Code Conventions before source edits.
- Source comments describe Hakka behavior directly; comparisons/credits to other
  products belong in ignored research material.
- `docs/` is the public documentation source of truth. Shared internal plans,
  memory, research, and handoffs belong in ignored `.agent/`. Never commit
  `.agent/`, `.claude/`, `.codex/`, `.ramen/`, `.stitch/`, `.references/`,
  `artifacts/`, or `CLAUDE.md`. Keep tool configuration in tool-specific folders.
- Do not skip pre-commit hooks. Broad UI redesign remains deferred until release;
  verify that milestone or follow an explicit user request before expanding scope.

## Verification

Use root `package.json` for CI scripts and `just` to discover local workflows:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run test
bun run lint
bun run fmt:check
```

Select native checks with `bun run build:android` / `test:android` and
`bun run build:ios` / `test:ios`; use `bun run docs:build` for public docs.
Cleanup: `bun run cleanup:check`. Package contents: `bun run pack:npm:dry-run`.
Spec or spec-card edits also require `just spec-drift-check spec-api-check`.
Release confidence uses `bun run phase:verify:ci` or the applicable local
`phase:verify` / `phase:verify:full`; physical benchmarks remain separate.

Match checks to the change while iterating, then run the complete applicable gate
once on the integrated result. Serialize builds/tests sharing dist, targets,
caches, or simulators. Record commands and revision; reuse unchanged evidence.

## Read when relevant

- Continuing work: relevant parts of `.agent/CURRENT.md` in the main worktree;
  refresh facts that changed since its evidence was captured.
- Source changes: Code Conventions and relevant platform/package sections of
  [instruction reference](docs/agent-reference.md).
- Build/release, research, delegated work, CI, or handoffs: corresponding sections
  of that reference and [contributor workflow](CONTRIBUTING.md). Its dated release
  and completion claims need fresh verification.

Keep detailed evidence in ignored `artifacts/` and a short current-state handoff
in `.agent/`; keep durable project rules in this tracked guide.
