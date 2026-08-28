# Hakka Android demo

A standalone traffic generator for the Hakka Android inspector. Every button fires a
real HTTP call (or wires a Hakka feature) so you can open the inspector and see the
SDK's panels doing something, not sitting empty. It's not a showcase app in its own
right, it exists to exercise `hakka-network` and `hakka-ui` end to end.

`applicationId` is `com.noodleapps.hakka.android`, min SDK 26, target SDK 35.

## Run it

From the `android/` directory:

```bash
# Build the debug APK
./gradlew :example:assembleDebug

# Build and install on a connected device or running emulator
./gradlew :example:installDebug

# Then launch it
adb shell am start -n com.noodleapps.hakka.android/.DemoActivity
```

Or from Android Studio: open the `android/` folder as a project, pick the `example` run
configuration, and press Run with a device or emulator selected.

The debug APK lands at `android/example/build/outputs/apk/debug/example-debug.apk` if
you'd rather sideload it directly with `adb install`.

On first launch, API 33+ devices show the system notification permission prompt (see
[Notifications](#notifications) below). Everything else works with no setup: the app
only needs internet access, which it already declares.

## What each section does

The screen is one long scroll, grouped by feature. Tap **Open Fullscreen**, **Open as
Sheet**, or **Show Floating Bubble** first, keep it open (as a sheet or bubble) or
switch back and forth, and watch requests land as you tap buttons below.

| Section         | What it shows                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspector       | The three ways a host app can present the inspector, plus shake-to-open (shake the device or emulator)                                                                                               |
| HTTP Methods    | GET/POST/PUT/DELETE against `httpbin.org`, the method-chip grammar the request list uses                                                                                                             |
| Response Sizes  | Small/medium/large JSON bodies, worth opening as a tree in the Response tab                                                                                                                          |
| Status Codes    | 200/404/500/429, the severity stripe on each row                                                                                                                                                     |
| Redirects       | 1, 3, and 6 hop redirect chains                                                                                                                                                                      |
| Timing          | A fast call plus 1s/3s delays, for the timing waterfall                                                                                                                                              |
| Content Types   | JSON, XML, and a PNG response                                                                                                                                                                        |
| Failures        | DNS failure, an expired-cert TLS failure, and a 403                                                                                                                                                  |
| Auth Headers    | A bearer token and a cookie, redacted in the headers view by default                                                                                                                                 |
| Batch Tests     | Rapid-fire bursts and one call of every type at once, good fodder for Stats                                                                                                                          |
| Mock Engine     | Every `MockRuleInput` shape: a full response, a blocked request, a redirected destination, an in-flight modify (header + body find/replace), a simulated failure, and `skipCount`/`stopAfter` gating |
| Breakpoints     | Adds a rule, then a request you can pause and resume (or abort) from Rules > Breakpoints                                                                                                             |
| Throttle        | Fast 3G / Slow 3G / Edge / Offline profiles, applied globally until reset to None                                                                                                                    |
| Structured Logs | `Hakka.logDebug/Info/Warn/Error`, the Logs tab's Structured mode                                                                                                                                     |
| Storage         | Writes a few `SharedPreferences` entries (including a redacted `token`) for the Storage tab                                                                                                          |
| WebSocket       | Opens a connection to a public echo server, sends a frame, and closes it, for the detail Frames tab                                                                                                  |
| GraphQL         | A query against a public GraphQL endpoint, for the detail GraphQL tab                                                                                                                                |
| Exports         | Not a button. A pointer to the share icon in the inspector's Network tab (HAR / cURL / Postman / OTel JSON)                                                                                          |
| Desktop Bridge  | Not a button either. A pointer to Settings inside the inspector, where you connect to the Hakka desktop app or `hakka mcp`                                                                           |

## A guided walkthrough

1. Tap **Show Floating Bubble**, then tap a few chips under **HTTP Methods**. Watch the
   bubble's request count and latency ring update live.
2. Tap **Add All Rules** under Mock Engine, then work through the six chips underneath
   it one at a time. Compare the requests in Network: the mocked ones never touched the
   real network (duration and body come entirely from the rule), the redirect and modify
   ones did a real round trip.
3. Tap **Skip+Stop x5** and open the request list. The first and fifth calls to
   `/user-agent` are real, the three in between are mocked, matching `skipCount = 1`,
   `stopAfter = 3`.
4. Under Breakpoints, tap **Add Rule** then **Trigger**. Open Rules > Breakpoints and
   you'll find the request paused, waiting for you to resume or abort it. Nothing else
   on this screen uses that same pattern, so it can't stall by accident.
5. Set **Slow 3G** under Throttle, then tap a couple of the earlier HTTP Method buttons
   again. Durations jump. Set it back to **None** when you're done.
6. Write demo prefs under Storage, then open the Storage tab: `token` shows up redacted
   (an exact key match against `sensitiveBodyFields`, not a substring one), because
   `installHakka()`'s `sensitiveBodyFields` in `DemoActivity.kt` includes `"token"`, and
   the Storage tab reuses that same redaction set.
7. Open a WebSocket, send a frame, close it, then open the request's detail Frames tab.
8. Send the GraphQL query and open its detail GraphQL tab: parsed operation, query text,
   and variables, all derived from the request/response bodies.
9. Select a request or two in Network and tap the share icon: HAR, cURL, a Postman
   collection, and OTel JSON all come from the same captured records.
10. Open Settings (the gearshape icon on every tab) to see the desktop bridge connect
    flow: manual `ws://` URL, or auto-discovery of a Hakka desktop app on the same
    network.

## Notifications

The auto-launcher notification (the sticky ongoing notification with a live request
inbox) needs `POST_NOTIFICATIONS` on API 33+, a runtime permission Android does not
grant automatically. `DemoActivity` asks for it once, in `onCreate`. If you decline, a
note appears at the top of the screen explaining that the notification and its inbox
are disabled, everything else (Fullscreen, Sheet, Bubble, shake) still works exactly the
same. To re-prompt after a decline, clear the app's notification permission from
Android's app-info screen and relaunch.

## What this app deliberately doesn't do

It always links the real `hakka-network` and `hakka-ui` artifacts, debug and release
alike, rather than swapping in `hakka-network-noop`/`hakka-performance-noop` for a
release build the way a production host app should (see the root
[README](../../README.md#android) for that dependency split). Demonstrating the noop
swap here needs a debug/release source-set split for `DemoActivity` itself (the noop
artifacts intentionally drop the UI-facing API surface this demo exercises), which is
out of scope for a traffic-generator app. `size-gate` is where the noop artifacts are
actually measured and enforced, see `android/README.md`.

## See also

- [`android/README.md`](../README.md): module layout, size budget, toolchain notes
- Root [`README.md`](../../README.md): the one-line `installHakka()` integration and
  the debug/release dependency split
