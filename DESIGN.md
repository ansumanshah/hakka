# Hakka design — "Wok Hei"

The design language for the Hakka inspector on every platform. **Wok Hei is the
internal name for the visual system; users never see it** — they see a fast,
quiet, warm instrument. Hakka (the product name) appears in docs and READMEs,
never as chrome text inside the inspector: the bowl-and-signal mark carries the
brand in-app.

Canonical color tokens: [`design-tokens.json`](./design-tokens.json) → synced to
all four platforms by `just sync-tokens`. The living component cards are in the
NoodleApps design-system project on claude.ai (`hakka/*`).

## Identity

Warm graphite ground (never navy, never pure black), one flame accent, and
semantic colors named after the kitchen: jade (success), chili (error),
turmeric (warning), steel (info/3xx), plum (PATCH/GraphQL). The timing
waterfall is the signature motif — a heat ramp from DNS (cold steel) to
download (flame): the request warms up as bytes arrive.

## Component grammar (applies on every platform)

- **Method chips**: outlined mono tints — method-colored text, ~40% border,
  ~10% background tint, fixed width. Never filled pills; chips whisper, status speaks.
- **Chips are for controls; rows get plain text.** The chip treatment above applies
  in _interactive_ contexts — the filter bar, the request-detail header, and the
  mock/breakpoint rule editors, where the method is something you pick. In **list
  rows** the method is data, not a control: plain method-colored mono text, no
  border, no background tint, fixed-width column. A row full of outlined boxes
  reads as a row of buttons and competes with the severity stripe and the status
  column for the eye. The chip helpers (`MethodChip` on RN/iOS,
  `methodChip()` on Android, `.hakka-chip` on web) stay reserved for control
  contexts; rows use the plain variant (`MethodLabel`,
  `styleAsPlainMethodText`, `.hakka-method-badge` with its box stripped).
- **Glyphs are verbs; chips and boxes carry state.** Stateless header/toolbar
  actions (pause, export, clear, settings) are bare glyphs — no border, no fill,
  no tile — sized to sit optically level with the tab labels beside them, with
  hit-slop restoring the 44pt target. A bordered-and-filled action tile reads as
  a toolbar bolted onto the chrome and makes the loudest element whichever
  button is most destructive. Boxes are reserved for controls that hold state.
- **Row severity stripes**: 2px left edge — chili for 5xx/error, turmeric for
  4xx, flame for the selected row (with ~9% flame background tint).
- **Accent discipline**: flame is only for active/selected/focus/primary.
  Steel-info is only the 3xx/info semantic (and console `info` log level).
- **Numbers are mono**: status/duration/size columns use the platform mono
  stack with tabular figures and fixed right-aligned widths.
- **Tabs**: mono, uppercase, letterspaced; flame underline for active.
- **The mark**: bowl + broadcast fan (no chopsticks — they turn to noise below
  24px). The jade arcs pulse while capturing, so the mark is also the recording
  indicator. Respect reduced-motion.
- **Mobile-first**: the primary filter row is search + methods + a "Filters +n"
  disclosure; everything else (status class, type, range, sort, group) lives
  behind it. Wide viewports (≥900px) get the split list/detail layout.
- **One radius rule**: every interactive control (buttons, chips, inputs,
  selects, seg tracks) is `radius-md` (6px). `radius-sm` (4px) only for tiny
  nested elements (segments inside a track, method badges inside rows).
  Pills (`radius-pill`) only for non-interactive badges/tags/counts. Circles
  only for dots and the entry bubble. Containers use `radius-lg`.
- **One height rule** (Yaak's biggest uniformity lever, adopted July 2026):
  every small interactive control is `ctl-h` (26px); action-bar buttons are
  `ctl-h-lg` (32px); rows and tabs are the 44px tap-target constant. No
  component invents its own height, and no ancestor overrides a control's
  height to a different value than its base.
- **Type is tokens-only**: `font-xs/sm/md/lg/xl` — never a raw px size (one
  documented exception: the 16px iOS-Safari zoom threshold on the mobile
  search input). Sans is `font-sans`, mono is `font-mono`; mono is reserved
  for DATA (methods, statuses, counts, durations, sizes, ids, code), sans for
  everything read as prose. Weights: 400 default, 600 emphasis, 700 only for
  method/status badge text.
- **Tints are named, not eyeballed**: `tint-hover` (9%), `tint-active` (15%),
  `tint-border` (40%) are the only `color-mix()` strengths. A new "active"
  wash never gets a hand-picked percentage.
- **Shared components over copies**: the boolean toggle is `.hakka-switch`;
  numeric pills are `.hakka-count-badge` — never reimplement either inline.

## Panel section anatomy (web)

**No tab has its own title or description.** The tab strip (Network, Stats,
Rules, Logs, Storage, Settings) already names the screen — repeating that
name in a header bar under it is wasted vertical space. Every tab's content
starts immediately at the top, the way Network (the list + `FilterBar`)
always has. Don't add a `.hakka-pane`-top title block to a tab; if you find
yourself reaching for one, the content below should just start.

The shared grammar applies one level down, to **section headers inside a
multi-section tab** — Storage's localStorage/sessionStorage/Cookies,
Rules' Add-rule/Active-rules lists (Mock and Breakpoints), Settings' groups
if it ever grows any: a **title** (`.hakka-section-title` — one class, one
size, 12px semibold, never uppercase/letterspaced) plus, where there's a
count, the canonical `.hakka-count-badge` beside it (its quiet `.outline`
modifier for a passive tally like a per-store item count; bare for an
emphasized number) — never a number baked into the title text
("Active rules (3)") or a one-off pill. No description under a section
title either.

**Teaching lives in empty states, not headers.** A tab or section explains
itself once, in the single sentence its empty state shows when there's
nothing to look at yet — Mock Rules' and Breakpoints' empty states are the
reference ("Mocks intercept fetch / XHR calls before they hit the network —
no request is made. Rules run on the main thread."). The explanation
disappears the moment real content exists; a populated list doesn't need to
keep re-explaining the mechanism next to every row. Anything narrower than a
full sentence (what a single control does) belongs in its `title`/
`aria-label`, not inline prose.

**Tab-strip badges carry state that matters before switching**, cheaply —
Logs already shows an error count (`Inspector.tsx`'s tab bar, red
`.hakka-count-badge`, hidden at zero so it never shifts layout). Only wire
one where the count is already reactive; don't add store plumbing (a
`subscribe` method, a poll loop) just to feed a badge — note the gap instead
(Rules' "active rule count" is skipped for this reason: `MockEngine` has no
change subscription today, and a badge counting only breakpoints while
silently omitting mock rules would misrepresent "active rules").

This replaced an earlier, wordier draft (a title + description on every
pane, mirroring `.hakka-card-title` at 13px for the tab and
`.hakka-section-title` at 10px uppercase for a nested label) that Ansh
called out as wasted space the moment he saw it rendered — the corrected
version above is what's implemented.

## Field-completeness contract (dev + QA)

If the engine captured it, the detail Overview shows it: request/response
sizes, protocol, encoding, redirects (+chain), retries, WebSocket frames
(+subprotocol), source+library, trace id, mocked/rewritten flags, and the
Request ID (cross-references `hakka mcp`'s `get_request`). Every platform's
Overview mirrors this list with conditional rows.

QA loop-closers next to every request: **Replay**, **copy as cURL/fetch**, and
**Mock this** (freezes the captured response into an enabled mock rule — same
engine as `hakka mcp`'s `generate_mocks`).

## Per-platform notes

- **Web** (`packages/hakka-browser`): reference implementation. Geometry/type scale live
  in `scripts/sync-design-tokens.mjs` (web layout block) + `src/ui/styles.ts`.
- **React Native** (`packages/hakka-react-native/src/ui`): tokens in
  `styles/tokens.ts`, reachable off the theme as `theme.spacing`,
  `theme.radius`, `theme.fontSize`, **`theme.controlHeight`** and
  **`theme.layout`**. Build pages from `components/primitives.tsx`
  (`Section`, `SectionTitle`, `Toolbar`, `Field`, `Button`, `IconButton`,
  `Segmented`) and `components/Chip.tsx` rather than restyling a bare `View` —
  see "One geometry" below.
- **iOS / Android**: colors and geometry both flow through the generated token
  files (`ThemeTokens.generated.swift` → `HakkaTokens` + `HakkaMetrics`,
  `GeneratedTokens.kt` → `GeneratedTokens` + `GeneratedMetrics`); component treatment
  is tracked in the cross-platform rollout plan. Android ships the Views-based
  `hakka-ui` as the default artifact; a Compose UI, if added, is a separate
  opt-in artifact — both are `debugImplementation`-only, so release APK size
  is unaffected either way.

## One geometry (all platforms)

Every interactive control snaps to the same height scale — `badge` 18, `chip`
24, `icon` 28, `field` 36, `nav` 40, `bar` 44 — and every page edge is the
gutter (16), never a raw spacing step, so a screen can't quietly pick its own.

The numbers are generated once, from the `metrics` block in
`scripts/sync-design-tokens.mjs`, into each platform's spelling:

| Platform     | Reach for                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Native | `theme.controlHeight.*` · `theme.layout.*` · `theme.spacing.*` · `theme.radius.*` · `theme.fontSize.*`; whole controls from `components/primitives.tsx` and `components/Chip.tsx` |
| Web          | `var(--hakka-ctl-h-*)` · `var(--hakka-gutter)` · `var(--hakka-space-*)` · `var(--hakka-radius-*)` · `var(--hakka-font-*)`                                                         |
| iOS          | `HakkaMetrics.ControlHeight.*` · `.Layout.*` · `.Spacing.*` · `.Radius.*` · `.FontSize.*` (`Theme.sN` is the legacy value-named alias, now delegating to these)                   |
| Android      | `GeneratedMetrics.ControlHeight.*` · `.Layout.*` · `.Spacing.*` · `.Radius.*` · `.FontSize.*` (`Theme.sN` / `Theme.radiusS/M/L` are the legacy aliases, now delegating to these)  |

Radii are `4 / 6 / 10 / 14`: iOS, Android and web already agreed on this, and RN
was the lone outlier at `4 / 8 / 12` until the scales were reconciled. `md` (6)
is the radius DESIGN.md's rule assigns to interactive controls.

This is enforced: `just ui-token-check` (also a pre-commit hook and a
`just verify` leg) fails on a raw geometry literal in the RN, web, iOS and
Android inspector styles. It exists because the inspector reached 0.1.0 with fifteen
distinct control heights and six different page gutters — the same text field
was 32pt in the request detail, 34pt in the console and 36pt in Settings, and
buttons had no height at all, only padding, so they never sat on the baseline of
the field beside them.

Widths are deliberately **not** checked. A fixed width is content-driven column
geometry (a method label's column, a timing column); heights are what make
controls share a baseline.

Genuinely one-off drawing geometry — a chart bar, a health rail, a switch thumb
— is not a control. Mark those `ui-token-check-ignore: <why>` on the line, or
`ui-token-check-ignore-next-line` above it where there's no room for a trailing
comment (JSX inline styles).

## Rules

- No raw hex outside generated token files — reference tokens.
- New colors enter through `design-tokens.json`, never a platform file.
- Single-value tokens (status/method/timing) must survive both grounds; pick
  mid-luminance values. Per-theme values (accent, surfaces) go in `dark`/`light`.
- Screenshot both themes at narrow + wide before calling any UI change done.

## No emojis — anywhere

Product UI, docs, code comments, marketing: no emoji glyphs, ever. This includes
emoji-rendered dingbats (U+2705 white-heavy-checkmark and friends). Affordances
use the icon set (per-platform icon components / vector drawables); status marks
in tables use geometric glyphs that never emoji-render: ● shipped, ◐ partial,
○ roadmap, — not offered, ⊘ out of scope. Plain words beat symbols when in doubt.
