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
platform implements its own native detector and overlay window; RN additionally ships a pure-JS
fallback path (`useShakeDetection`, the bubble/FAB inside `HakkaInspector.Wrapper`) so triggers
work even when the optional native UI package isn't linked.

## Public API

Core (`hakka-core`, consumed by any JS host — RN today):

```ts
import { Hakka } from 'hakka-core'

Hakka.show(options?: { as?: 'bubble' | 'sheet' | 'fullscreen' }): boolean // false if no native UI module handled it
Hakka.hide(): void
```

RN (`hakka-react-native` — `HakkaInspector.Wrapper` + its imperative namespace):

```tsx
import { HakkaInspector } from 'hakka-react-native/ui'

<HakkaInspector.Wrapper mode="bubble" shake={{ enabled: true }} bubble={{ renderMode: 'js' }}>
  <App />
</HakkaInspector.Wrapper>

HakkaInspector.isVisible(): boolean
HakkaInspector.show(): void          // shows the bubble (bubble mode) or the inspector (other modes)
HakkaInspector.hide(): void
HakkaInspector.showInspector(): void // opens the modal/sheet directly, bypassing the bubble
HakkaInspector.hideInspector(): void
HakkaInspector.getVisibility(): InspectorVisibility | null // { bubbleVisible, inspectorVisible }
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

| Platform | Key                                | Default                 | Notes                                                            |
| -------- | ---------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| RN       | `shake.enabled`                    | `true`                  | `ShakeConfig`                                                    |
| RN       | `shake.sensitivity`                | `1.2`                   | accepted, not read by `useShakeDetection` today                  |
| RN       | `shake.minShakes`                  | `1`                     | accepted, not read by `useShakeDetection` today                  |
| RN       | `shake.timeWindow`                 | `1000` ms               | debounce between accepted shakes                                 |
| RN       | `bubble.showOnInit`                | `false`                 | `BubbleConfig`                                                   |
| RN       | `bubble.size`                      | `56` px                 | clamped to a minimum of `56`                                     |
| RN       | `bubble.renderMode`                | `'js'`                  | `'js' \| 'native'` — native delegates to `Hakka.show()`          |
| iOS      | shake threshold / cooldown / count | `2.5` / `0.5` s / `2`   | `HakkaShakeDetector`, not configurable at the call site          |
| iOS      | notification debounce              | immediate               | `NotificationTrigger` posts on `didEnterBackground`, no debounce |
| Android  | shake threshold / cooldown / count | `12.0` / `500` ms / `2` | `ShakeDetector`, not configurable at the call site               |
| Android  | notification debounce              | `300` ms                | `HakkaNotificationManager.scheduleUpdate`                        |
| Android  | notification inbox size            | `8` lines               | `HakkaNotificationManager.INBOX_SIZE`                            |

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

- **Shake to open** — RN's `useShakeDetection` listens for RN's own `'shake'` `DeviceEventEmitter`
  event (iOS/Android both fire it). iOS additionally wires `CMMotionManager` directly
  (`HakkaShakeDetector`) plus a `motionEnded(.motionShake)` override on `ShakeWindow` for
  Cmd+Ctrl+Z in Simulator. Android uses `SensorManager`/`TYPE_ACCELEROMETER` directly. Web ships
  no shake handling — there's no equivalent low-noise browser gesture API in use here.
- **Draggable bubble / FAB** — a persistent, position-remembering, drag-to-edge entry point on
  every platform: RN's `useBubbleDrag` hook inside `HakkaInspector.Wrapper`, iOS's `BubbleWindow`
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
  RN), `HakkaInspector.show()`/`.hide()`/`.showInspector()`/`.hideInspector()` (RN's own
  component-level API, independent of native linking), iOS's `OverlayWindow`/`BubbleWindow`
  singletons, and Android's `HakkaUI.show()`/`.hide()`/`.showSheet()`. Web has no equivalent
  exported call — only the FAB and a keyboard shortcut open the panel.

## Wire format

None — triggers are local UI/OS-integration features, not something serialized over the bridge or
control-channel protocol. RN's shake event rides React Native's own `DeviceEventEmitter` (event
name `'shake'`, no payload); `ShakeConfig`/`BubbleConfig`/`InspectorVisibility` (all in
`packages/hakka-core/src/model/types.ts`) are the closest thing to a schema, and are plain in-process
prop/option shapes, not wire messages.

## Test anchors

- `packages/hakka-core/src/engine/HakkaFacade.show.test.ts` — `Hakka.show()`/`.hide()` return-value and
  native-adapter-missing behavior.
- `packages/hakka-browser/src/ui/Inspector.test.tsx` (`opens panel on toggle button click`) — the web FAB.

No dedicated test exists for shake detection or the bubble/notification UI on RN, iOS, or Android
— see Limits below.

## Limits & non-goals

- **App launcher shortcut is unimplemented.** SPEC §3 lists it as an Android trigger; nothing in
  `android/` creates one (no `ShortcutManager`/`ShortcutManagerCompat` call, no `shortcuts.xml`
  resource, no manifest `<shortcuts>` `<meta-data>`). Treat it as roadmap, not shipped, until code
  lands — this doc could not verify the SPEC.md claim against source.
- RN's `ShakeConfig.sensitivity` and `.minShakes` are accepted by the type and threaded through
  `HakkaInspector.Wrapper`'s props, but `useShakeDetection` never reads them — only `timeWindow`
  (the debounce) has an effect. iOS/Android shake thresholds are hardcoded constants, not exposed
  to the host app at all.
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
