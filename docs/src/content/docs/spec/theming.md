---
title: Theming
description: Spec card — "Wok Hei", the shared color-token system generated from one JSON source to RN, iOS, Android, and web.
---

## What it does

`design-tokens.json` is the single source of truth for color across every platform's inspector
UI — status/method/timing semantics, dark/light palettes, and code-viewer syntax colors.
`scripts/sync-design-tokens.mjs` mirrors it into a generated companion file per platform
(TS, Swift, Kotlin, CSS custom properties); spacing/radii/type stay per-platform (tuned to each
layout) and are intentionally not unified in the JSON source.

## Public API

Not a runtime API — a build-time codegen step:

```bash
node scripts/sync-design-tokens.mjs         # regenerate the 4 companion files
node scripts/sync-design-tokens.mjs --check # verify they're in sync (CI gate); exit 1 + diff on drift
```

Generated outputs consumed directly by each platform's UI code (do not hand-edit — edit
`design-tokens.json` and re-run the script):

| Platform | Generated file                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| RN       | `packages/hakka-react-native/src/ui/styles/tokens.generated.ts`                                             |
| iOS      | `ios/Sources/UI/ThemeTokens.generated.swift`                                                                |
| Android  | `android/hakka-ui/src/main/kotlin/com/noodleapps/hakka/ui/GeneratedTokens.kt`                               |
| Web      | `packages/hakka-browser/src/ui/tokens.css` (Shadow DOM custom properties, `:host`/`:host([theme='light'])`) |

## Config keys + defaults

Not a runtime config surface — `design-tokens.json` top-level groups: `status`, `method`,
`timing`, `dark`, `light`, `codeDark`, `codeLight`. Web additionally emits a fixed layout scale
(radii, spacing, font sizes, control heights, tint strengths) that has no JSON-source equivalent
— it's hardcoded in `emitCSS()` since RN/iOS/Android tune those per-platform instead.

## Platform matrix

Not a distinct row in SPEC §5 — verified directly against `sync-design-tokens.mjs`'s `targets`
list, which writes all four:

| Capability           | RN  | iOS | Android | Web | Mac app |
| -------------------- | --- | --- | ------- | --- | ------- |
| Theming (token sync) | ●   | ●   | ●       | ●   | ●       |

## Wire format

None — token values are hex strings without a `#` prefix in the JSON source (`"3AA981"`), each
emitter adds the platform-appropriate prefix (`'#3AA981'` in TS/Kotlin/CSS, `0x3AA981` as a
`UInt32` in Swift).

## Test anchors

No dedicated unit test — the CI gate is the `--check` mode itself (`scripts/sync-design-tokens.mjs --check`, wired to the `sync-tokens-check` `justfile` recipe), which diffs each generated file's actual content against freshly-rendered content and exits non-zero listing every out-of-sync file.

## Limits & non-goals

- Colors only — spacing, radii, typography scale, and control heights are deliberately **not**
  unified across platforms; `DESIGN.md`'s component grammar (one radius rule, one height rule,
  named tint strengths) is enforced by convention and review, not by this generator.
- The generator only ever overwrites its four declared target files — hand edits to any other
  file are untouched, and hand edits to a generated file itself are silently clobbered on the
  next `sync-tokens` run (each file carries an `@generated ... do not edit` banner).
- "Wok Hei" is an internal codename (`DESIGN.md`) — it never appears as in-app chrome text; only
  the bowl-and-signal mark carries the brand.
