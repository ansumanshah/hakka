---
title: Rozenite
description: EXPERIMENTAL — Hakka's network inspector as a panel inside React Native DevTools via Rozenite, not yet verified against a real running app.
---

> **Experimental — not yet verified against a real running app.** Rozenite's plugin API is
> young and still moving. This package is built and tested against the coordinated Rozenite
> `2.4.0` family and Vite `7.3.6`. Automated checks exercise the real in-process Rozenite
> transport, and the repository's bare React Native example passes Metro plugin discovery and
> bundling. A simulator or physical device is still required to verify the React Native
> DevTools sidebar and device-side CDP transport. Treat this package's shape as likely to
> change alongside Rozenite's, not as a stable contract.

`hakka-rozenite` renders Hakka's network inspector as a panel inside **React Native DevTools**,
via [Rozenite](https://rozenite.dev). It renders the same
[`hakka-browser/elements`](/embedding/components/) custom elements the rest of the Hakka web
ecosystem uses — `<hakka-request-list>`, `<hakka-request-detail>`, `<hakka-filter-bar>` —
through their typed [`hakka-browser/react`](/embedding/react/) wrappers, fed live from
[`hakka-react-native`](/react-native/package/)'s capture stream.

Reach for this only if you already use React Native DevTools and have Rozenite configured in
your app's Metro/Re.Pack config. If you don't, `hakka-react-native`'s own in-app inspector
(covered in [React Native Package](/react-native/package/)) or the
[desktop bridge](/bridge/overview/) are the non-experimental ways to see RN network traffic.

## Install

```sh
bun add hakka-rozenite
```

`hakka-react-native` is a peer dependency, and it's pinned to the exact version
`0.1.0` (not a range) — a stricter pin than most peer dependencies in this ecosystem, worth
noting if you're used to range-based peers elsewhere.

## Setup

Requires Rozenite already configured in your app's Metro/Re.Pack config — see
[Rozenite's own quick start](https://rozenite.dev/docs/getting-started); this package doesn't
configure that for you, the same way every other Rozenite plugin doesn't.

The repository's bare React Native example is a working Metro reference. Its
`start:rozenite` script enables Rozenite and limits discovery to `hakka-rozenite`.

Call the hook once, alongside `useHakka()`:

```ts
import { useHakkaRozeniteDevTools } from 'hakka-rozenite'

function App() {
  useHakka()
  useHakkaRozeniteDevTools()
  // ...
}
```

`useHakkaRozeniteDevTools` is exported from this package's `react-native` entry
(`hakka-rozenite`/`hakka-rozenite/react-native` — both resolve to the same build). It's
lazy-required and a no-op on web, under SSR, and in production bundles, so it's safe to call
unconditionally rather than gating it behind a dev-only check yourself.

## Architecture

```
hakka-rozenite/
├── rozenite.config.ts   # one panel: src/ui/App.tsx
├── react-native.ts      # lazy RN entry point (no-op in prod/web/SSR)
└── src/
    ├── shared/protocol.ts        # plugin id + event map
    ├── react-native/bridge.ts    # createHakkaRozeniteBridge — RN-side wiring
    └── ui/
        ├── App.tsx        # the panel: FilterBar + RequestList + RequestDetail
        └── panelStore.ts  # store adapter fed by client messages
```

**RN side.** `useHakkaRozeniteDevTools()` gets a Rozenite client
(`useRozeniteDevToolsClient` from `@rozenite/plugin-bridge`), then
`createHakkaRozeniteBridge` flushes `Hakka.getLogs()` as individual `request` frames,
subscribes to `Hakka.onRequest` for live ones, and answers the panel's
`get-snapshot`/`clear` messages. It imports `Hakka` straight from `hakka-core`, the same thing
`hakka-react-native`'s own `HakkaBridge.ts` does for its desktop-bridge integration.

**Panel side.** `App.tsx` gets its own Rozenite client, builds a `panelStore`
(`getSnapshot()`/`subscribe()`/`clear()`/`ingest()`) that mirrors incoming `request`/`cleared`
frames, and passes that store into both `<FilterBar store>` and `<RequestList store>` from
`hakka-browser/react` — those two wire together automatically via `hakka-browser/elements`'s
shared `FilterViewModel`/`SelectionViewModel` singletons. Selecting a row passes the resolved
`NetworkRequest` object directly into `<RequestDetail request>`, bypassing
`hakka-browser/elements`'s `request-id`-against-shared-store resolution entirely, since this
plugin's store is never that shared singleton.

## Data path: Rozenite messaging, not the desktop bridge hub

Captured requests reach the panel over Rozenite's own `useRozeniteDevToolsClient` messaging —
**not** by connecting the panel directly to the Hakka desktop bridge hub
(`ws://localhost:8989`, [Bridge overview](/bridge/overview/)'s protocol). Every captured
request is sent as its own `client.send('request', ...)` call — one frame per request, no
batching, mirroring `hakka-react-native`'s own desktop-bridge behavior. There's no separate
pre-connect queue: `Hakka.getLogs()` is already `hakka-react-native`'s persistent capture
store, so the bridge reads it directly (`flushBacklog()`) the moment the client connects.

This has **not been load-tested against a real high-volume capture session**. If a real app
shows the Rozenite channel struggling under volume, the documented (but unimplemented)
fallback is connecting the panel to the desktop bridge hub instead, reusing
`hakka-react-native`'s existing `HakkaBridge`/desktop wire protocol.

## What's read-only today

This plugin is v0.1.0 and read-only: unlike Rozenite's own official
`@rozenite/network-activity-plugin`, it does not yet let you edit a response before it reaches
the app. `hakka-core`'s `mockEngine`/`ThrottleEngine` — already used by
`hakka-react-native`'s own Mocks/Throttle panels — are the natural next step for this panel, but
they aren't wired in here yet.

## Testing — what's covered, what needs a real app

**Covered** (`bun run --cwd packages/hakka-rozenite test`, happy-dom + vitest):

- `react-native/__tests__/bridge.test.ts` — backlog-flush/live-forward/`get-snapshot`/`clear` wiring,
  against a fake Rozenite client and a fake `Hakka` facade.
- `ui/__tests__/panelStore.test.ts` — the store adapter's upsert-by-id mirroring, subscriber fan-out,
  `clear()`/`ingest()`/`destroy()`.
- `ui/__tests__/App.test.tsx` — mounts the real panel with `useRozeniteDevToolsClient` mocked; verifies
  the connecting state, that all three custom elements mount and register, row selection
  reaching the detail pane, and listener cleanup on unmount.
- `shared/__tests__/rozeniteTransport.test.ts` — joins real Rozenite 2.4 clients through
  `@rozenite/testing`; verifies request delivery into the panel and clear delivery back to the
  RN-side bridge.

**Not covered — needs a real app with React Native DevTools open:**

- `useHakkaRozeniteDevTools()` calling the _real_ `useRozeniteDevToolsClient` — its channel
  depends on `global.__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__` (device) or a live
  `postMessage`-connected parent (panel), neither reproducible in a unit test.
- Whether the RN ↔ panel round trip holds up under a real capture session's volume.
- Whether the plugin already found by the example's Rozenite-enabled Metro bundle mounts in a
  real React Native DevTools sidebar.

**Manual verification steps** (do this before treating the integration as done):

1. Run `bun run --cwd packages/hakka-react-native/examples/react-native-example start:rozenite`.
2. Build and open that example on a simulator or device.
3. Open React Native DevTools and confirm a "Hakka" panel appears in the sidebar.
4. Trigger some network requests; confirm they appear live in the panel's request list, and
   that the detail pane and filter bar behave as expected.
5. Click "Clear" in the panel; confirm `Hakka.getLogCount()` in the app goes to zero too, not
   just the panel's own view.

## Known limitations

- **"Load sample traffic" in the empty-state `<RequestList>` only updates the panel's own local
  mirror.** This plugin has no synthetic demo-data source, so `ingest()` on the store adapter
  never forwards anything back to the device.
- **No batching.** Every request is its own message frame — see "Data path" above.
- **Read-only** — no mock/throttle/breakpoint controls in the panel yet (see above).

## See also

- [Components](/embedding/components/) — the custom elements this panel renders.
- [React](/embedding/react/) — the typed wrappers this panel uses to render them.
- [React Native Package](/react-native/package/) — `hakka-react-native`, the capture source
  this panel is fed from.
- [Bridge overview](/bridge/overview/) — the desktop bridge hub this panel deliberately does
  _not_ use (see "Data path" above).
