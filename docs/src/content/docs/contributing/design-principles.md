---
title: Design Principles
description: Capture, privacy, performance, and interface rules for Hakka.
---

Hakka runs inside other applications. Capture must be accurate, bounded, and independent of the inspector UI.

## Core first

Android and iOS own capture, redaction, filters, body limits, storage, export,
and noop behavior. React Native provides the TypeScript API, TurboModule
bridge, native inspector presentation, and JavaScript-only monitors.

Interceptors collect raw facts and return promptly. Processors and snapshot
readers handle normalization, redaction, export, and notifications.

## Local and bounded

Captured data stays local by default. Applications may attach their own sinks.
Sensitive headers are redacted before records reach stores, UI, exports, or
streaming. Apply host and URL filters before expensive processing.

Cap record counts, body previews, persistence, and sink queues. Evict old records
when storage fills. Avoid per-event disk writes. See [Performance](/concepts/performance/)
for measurements and the scripts that enforce runtime and size budgets.

## Optional dependencies

Core modules stay free of UI frameworks, observability SDKs, storage engines,
and large parsers. Optional features belong in separate imports or artifacts.
Android Compose UI lives in `hakka-ui`; iOS SwiftUI lives in `HakkaUI`.
React Native opens those inspectors through the bridge. Programmatic APIs work
without loading an inspector.

## Identity and color

Use Hakka in public code, docs, records, tests, and examples. "Wok Hei" is an
internal design name. In-app branding uses the bowl-and-broadcast mark.

The palette uses warm graphite surfaces, a flame accent, jade for success,
chili for errors, turmeric for warnings, steel for information and 3xx, and
plum for PATCH/GraphQL. The timing waterfall runs from steel for DNS to flame
for download. Flame marks active, selected, focused, and primary controls.

Colors come from `design-tokens.json`, synchronized with `just sync-tokens`.
Add colors there, then use generated tokens. Semantic colors must remain
legible in both themes; surfaces and accents may use theme-specific values.
Respect reduced motion when animating the capture indicator.

## Controls and rows

- Use outlined, method-colored mono chips where users choose a method. In list
  rows, show methods as plain colored text in a fixed-width column.
- Stateless toolbar actions use bare icons with accessible labels and native
  touch targets: at least 44 pt on iOS and 48 dp on Android.
- Rows use a 2 px severity stripe: chili for errors/5xx, turmeric for 4xx,
  flame for selection. Selection uses the active background token.
- Methods, statuses, counts, durations, sizes, IDs, and code use monospace.
  Prose uses sans serif. Numeric columns use tabular figures and align right.
- Use token font sizes and spacing. Web search inputs may use 16 px to prevent
  iOS Safari from zooming on focus.
- Reuse shared switches, count badges, chips, and buttons. Hover, active, and
  border tints use named tokens.

## One geometry

Control heights use the generated scale: badge 18, chip 24, icon 28, field 36,
nav 40, bar 44. Page edges use the gutter token (16). Visual size and touch-target
size are separate. Interactive controls use the medium radius (6); small nested
parts use 4, containers use the larger radius tokens, and passive badges may
use pills. Circles are reserved for dots and the entry bubble.

| Platform     | Tokens                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| Web          | `--hakka-ctl-h-*`, `--hakka-gutter`, spacing, radius, and font variables        |
| iOS          | `HakkaMetrics.ControlHeight`, `.Layout`, `.Spacing`, `.Radius`, `.FontSize`     |
| Android      | `GeneratedMetrics.ControlHeight`, `.Layout`, `.Spacing`, `.Radius`, `.FontSize` |
| React Native | Uses the native iOS/Android inspectors                                          |

`just ui-token-check` checks control geometry. Content-driven column widths and
one-off drawing geometry are exceptions; annotate the latter with
`ui-token-check-ignore: <reason>` or `ui-token-check-ignore-next-line`.

## Panel sections

The tab strip names the screen. Start each tab with its content, without a
repeated title or description. Nested sections may have a sentence-case title
and shared count badge. Explain features in empty states; use tooltips and
accessibility labels for individual controls.

Tab badges show state useful before switching tabs. Use an existing subscription
for the count; avoid adding polling solely for a badge. On narrow screens, keep
search, methods, and a filter disclosure visible. The web inspector uses a split
list/detail layout at 900 px and wider.

## Detail completeness

Show captured sizes, protocol, encoding, redirects, retries, WebSocket frames,
source/library, trace ID, request ID, and mocked/rewritten flags where available.
Request actions include replay, copy as cURL/fetch, and creating a mock from the
captured response. Check both themes and narrow/wide layouts for UI changes.

## Text and icons

Use short labels and concrete empty-state instructions. Product UI, docs,
comments, and marketing use icons or plain words instead of emoji. Status tables
may use ● shipped, ◐ partial, ○ roadmap, ⊘ out of scope.
