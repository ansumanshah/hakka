---
title: Triggers
description: Spec card — every way the inspector gets summoned — shake-to-open, the floating bubble, the live-stats notification, and the imperative show()/hide() trigger API.
---

## What it does

Triggers are the entry points that bring the inspector on screen without the host app wiring a
button of its own: a physical shake gesture, a persistent draggable bubble/FAB the user long-presses
to open (a tap just expands a quick summary in place, and a drag repositions it), a
live system notification (Android's has a request inbox, iOS's is one-shot), and a programmatic
`show()`/`hide()` API a host app can call directly (e.g. from a debug menu or a deep link). Each
platform implements its own native detector and overlay window. React Native uses the native
iOS and Android trigger surfaces through the TurboModule bridge; JS capture and hooks remain
available without native UI.

## Public API

Core (`hakka-core`, consumed by any JS host — RN today):

```ts
import { Hakka } from 'hakka-core'

Hakka.show(options?: { as?: 'bubble' | 'sheet' | 'fullscreen' }): Promise<boolean> // resolves after native presentation
Hakka.hide(): void
```

RN (`hakka-react-native`):

```tsx
import { Hakka } from 'hakka-react-native'

Hakka.start({ mode: 'native' })
await Hakka.show({ as: 'bubble' | 'sheet' | 'fullscreen' })
Hakka.hide()
```

iOS (Swift, `HakkaUI` target — `UIWindow`/singleton classes, all `@MainActor`):

```swift
window.enableHakkaShakeDetection()                 // default: toggles the bubble, then the sheet
window.enableHakkaShakeDetection(onShake: { ... })  // custom handler
window.disableHakkaShakeDetection()

BubbleWindow.shared.show() / .hide() / .toggle()
OverlayWindow.shared.show() / .showFullscreen() / .showMonitor() / .hide() / .toggle()

NotificationTrigger.shared.requestAuthorization() // optional — only to raise the prompt
NotificationTrigger.shared.onRequest() / .onError() / .resetCounts() / .cancelNotifications()
```

Android (Kotlin, `hakka-ui` — `HakkaUI` singleton):

```kotlin
val ui = HakkaUI.getInstance(context)
ui.init(onShake = { /* ... */ })
ui.start()  // begin listening for shake gestures
ui.stop()   // stop listening, clear the notification
ui.show(activity)      // show the floating bubble
ui.hide()
ui.showSheet(activity) // open the bottom sheet inspector directly
ui.onRequest(request)  // feed a captured request in — updates the notification + bubble count
```

Web has no shake or notification trigger — the overlay's only entry point is the draggable FAB
built into `Inspector.tsx` (no exported `show()`/`open()` — it's local component state, toggled
by the FAB or a keyboard shortcut, never driven by a host page).

## Config keys + defaults

Not part of `HakkaConfig` — configured per-call/per-component, not through shared config:

| Platform | Key                                | Default                 | Notes                                                              |
| -------- | ---------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| RN       | `Hakka.show({ as })`               | —                       | `'bubble' \| 'sheet' \| 'fullscreen'`; resolves after presentation |
| iOS      | shake threshold / cooldown / count | `2.5` / `0.5` s / `2`   | `HakkaShakeDetector`, not configurable at the call site            |
| iOS      | notification debounce              | immediate               | `NotificationTrigger` posts on `didEnterBackground`, no debounce   |
| Android  | shake threshold / cooldown / count | `12.0` / `500` ms / `2` | `ShakeDetector`, not configurable at the call site                 |
| Android  | notification debounce              | `300` ms                | `HakkaNotificationManager.scheduleUpdate`                          |
| Android  | notification inbox size            | `8` lines               | `HakkaNotificationManager.INBOX_SIZE`                              |

## Platform matrix

SPEC §3's Triggers bullet has no row in §5 today — these rows are new, chosen not to collide with
any existing §5 row name:

| Capability              | RN  | iOS | Android | Web | Mac app |
| ----------------------- | --- | --- | ------- | --- | ------- |
| Shake to open           | ●   | ●   | ●       | —   | ⊘       |
| Draggable bubble / FAB  | ●   | ●   | ●       | ●   | ⊘       |
| Live-stats notification | —   | ◐   | ●       | —   | ⊘       |
| App launcher shortcut   | —   | —   | ○       | —   | ⊘       |
| Imperative trigger API  | ●   | ●   | ●       | —   | ⊘       |

- **Shake to open** — RN delegates to the native iOS/Android detectors through the TurboModule.
  iOS additionally wires `CMMotionManager` directly
  (`HakkaShakeDetector`) plus a `motionEnded(.motionShake)` override on `ShakeWindow` for
  Cmd+Ctrl+Z in Simulator. Android uses `SensorManager`/`TYPE_ACCELEROMETER` directly. Web ships
  no shake handling — there's no equivalent low-noise browser gesture API in use here.
- **Draggable bubble / FAB** — a persistent, position-remembering, drag-to-edge entry point on
  every platform: RN's native surface, iOS's `BubbleWindow`
  (pan gesture, snap-to-edge, idle fade, hide zone), Android's `HakkaBubble`
  (`WindowManager`-hosted `FrameLayout`, same snap/hide-zone behavior), and web's `Inspector.tsx`
  draggable `.hakka-toggle` button (pointer events, persists position via `saveUiState`). All four
  share the same three-way gesture: a tap expands a compact recent-requests summary in place, a
  long-press opens the full inspector, and a drag past the slop threshold repositions the bubble
  and cancels any pending long-press. RN, iOS, and web tune long-press duration and movement
  tolerance to matching constants; Android deliberately uses the platform's own
  `GestureDetector`/`ViewConfiguration` long-press and touch-slop defaults instead, so the gesture
  feels native rather than cross-platform-uniform.
- **Live-stats notification** — Android's `HakkaNotificationManager` posts a sticky
  `Notification.InboxStyle` notification (last 8 requests, method/status/path, a "+N more"
  summary, tap-to-open, a Clear action) via `HakkaNotificationReceiver`. iOS's
  `NotificationTrigger` posts a single system notification with just a running count
  (`"N requests, M errors"`) when the app backgrounds — no inbox, no per-request lines; marked
  partial for that reason. RN and web ship neither.
- **App launcher shortcut** — listed in SPEC §3 ("app launcher shortcut (Android)") but no
  `ShortcutManager` call, `shortcuts.xml`, or manifest `<meta-data>` for one exists anywhere in
  `android/`. Marked roadmap, not shipped — see Limits below.
- **Imperative trigger API** — `Hakka.show()`/`Hakka.hide()` (`hakka-core`, consumed directly by
  RN), iOS's `OverlayWindow`/`BubbleWindow`
  singletons, and Android's `HakkaUI.show()`/`.hide()`/`.showSheet()`. Web has no equivalent
  exported call — only the FAB and a keyboard shortcut open the panel.

## Wire format

None — triggers are local UI/OS-integration features, not something serialized over the bridge or
control-channel protocol. RN's `Hakka.show()` options are plain in-process values, not wire
messages.

## Test anchors

- `packages/hakka-core/src/engine/__tests__/HakkaFacade.show.test.ts` — `Hakka.show()`/`.hide()` return-value and
  native-adapter-missing behavior.
- `packages/hakka-browser/src/ui/__tests__/Inspector.test.tsx` (`opens panel on toggle button click`) — the web FAB.

No dedicated test exists for shake detection or the bubble/notification UI on RN, iOS, or Android
— see Limits below.

## Limits & non-goals

- **App launcher shortcut is unimplemented.** SPEC §3 lists it as an Android trigger; nothing in
  `android/` creates one (no `ShortcutManager`/`ShortcutManagerCompat` call, no `shortcuts.xml`
  resource, no manifest `<shortcuts>` `<meta-data>`). Treat it as roadmap, not shipped, until code
  lands — this doc could not verify the SPEC.md claim against source.
- RN's former JS `ShakeConfig` and `BubbleConfig` props are removed. Shake thresholds remain native
  platform details rather than React Native component options.
- iOS's `NotificationTrigger` re-reads the live authorization state on every
  `didBecomeActive`, so a host app that already holds notification permission works without
  calling `requestAuthorization()` at all — call it only when you want Hakka to raise the
  prompt. It still never takes `UNUserNotificationCenter.delegate` from another owner: if one
  is already set it leaves it alone and tap-to-open is disabled (a `DEBUG`-only log says so).
- No shake, notification, or launcher-shortcut trigger exists for web — its only summon path is
  the draggable FAB (and, inside the panel, keyboard shortcuts once it's already open).
- Zero automated test coverage for shake detection or the bubble overlay on RN, iOS, or Android —
  the only trigger paths under test are the core `Hakka.show()`/`.hide()` facade and web's toggle
  button.
