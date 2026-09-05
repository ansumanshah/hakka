# hakka-rozenite

> **Experimental.** Rozenite's plugin API is young and still moving (see
> "Rozenite version" below): treat this package's shape as likely to change
> alongside it, not a stable contract. Built and tested against the complete
> Rozenite `2.4.0` family and Vite `7.3.6`. The repository's React Native
> example now exercises Metro discovery during its Rozenite-enabled bundle,
> and the real DevTools sidebar has been verified on an iOS simulator. See
> "Verification status" below.

Hakka's network inspector as a panel inside **React Native DevTools**, via
[Rozenite](https://rozenite.dev). Renders the same
[`hakka-browser/elements`](../hakka-browser/elements) custom elements the rest of the
Hakka web ecosystem uses (`<hakka-request-list>`, `<hakka-request-detail>`,
`<hakka-filter-bar>`) through their typed [`hakka-browser/react`](../hakka-browser/react)
wrappers, fed live from [`hakka-react-native`](../hakka-react-native)'s
capture stream.

## Rozenite version this was built against

The package uses the coordinated Rozenite `2.4.0` release for `rozenite`,
`@rozenite/vite-plugin`, `@rozenite/plugin-bridge`, `@rozenite/metro`, and
`@rozenite/testing`. `@rozenite/vite-plugin@2.4.0` declares Vite `^7.3.1`, so
the workspace uses Vite `7.3.6` rather than the incompatible Vite 8 line.

The plugin contract this package relies on, confirmed by reading Rozenite's
own docs (`website/src/docs/plugin-development/*.md`) and two official
plugins (`packages/mmkv-plugin`, `packages/network-activity-plugin`) rather
than assuming it from the getting-started guide alone:

- **Package shape**: `rozenite.config.ts` (`panels: [{ name, source }]` and
  `integrations: ['react-native']`),
  an optional `react-native.ts` entry point, a `vite.config.ts` using
  `rozenitePlugin()` from `@rozenite/vite-plugin`. `rozenite build` runs
  `vite build` once per detected target (panels always; `react-native.ts`/
  `metro.ts`/`sdk.ts` each add one more pass with `VITE_ROZENITE_TARGET` set)
  and auto-syncs `package.json`'s `main`/`module`/`types`/`exports` fields to
  match whichever entry points exist, confirmed by reading the CLI's
  `syncPluginPackageJSON`, not just the docs.
- **Messaging bridge**: both sides construct
  `useRozeniteDevToolsClient<TEventMap>({ pluginId })` from
  `@rozenite/plugin-bridge`, the exact same hook on the RN side and inside
  the DevTools panel. `pluginId` must equal the package's `name` field (the
  dev host fills it in from `package.json`, per Rozenite's own docs). The
  hook picks its transport automatically: a CDP domain proxy
  (`global.__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__`) on the device side, or
  `window.postMessage` to the parent frame inside the panel's iframe; both
  produce the same `client.send(type, payload)` / `client.onMessage(type,
cb)` / `client.close()` API, typed end-to-end by `TEventMap`.
- **Panel = a React component.** `rozenite.config.ts`'s `panels[].source`
  points at a plain React entry file rendered inside an iframe embedded in
  React Native DevTools.

## Data path: Rozenite plugin messaging, not the bridge hub

The RN-side hook forwards `Hakka`'s capture stream to the panel over
Rozenite's own `useRozeniteDevToolsClient` messaging, **not** by having the
panel connect directly to the Hakka desktop bridge hub
(`ws://localhost:8989`, `hakka-bridge`'s own protocol). Two things this
package's design leans on to make that call:

1. **Precedent at the same traffic volume.** Rozenite's own official
   `@rozenite/network-activity-plugin` forwards live HTTP/WebSocket/SSE
   traffic (the same kind of workload this package forwards) over this
   exact same client messaging, with the same `client.send()` per request
   shape this package uses. If that transport didn't hold up under live
   network-capture volume, it would be the officially maintained network
   plugin hitting the problem first, not this one.
2. **Simpler dependency footprint for the common case.** A Rozenite user
   already has React Native DevTools open and Rozenite configured in Metro/
   Re.Pack: no separate desktop app or `ws://localhost:8989` listener has to
   be running. Going through the bridge hub instead would mean the panel
   depends on a _second_ transport (`hakka-bridge`'s WebSocket protocol) on
   top of the one Rozenite already gives it for free.

**Not yet load-tested against a real high-volume capture session**: this is
a design decision made from reading Rozenite's own architecture and its
official network plugin's precedent, not from profiling this package's own
transport under load (there's no running RN DevTools session in this
environment to profile against). If a real app later shows the Rozenite
channel choking under volume (the CDP domain proxy's `postMessage`-per-event
model is the plausible failure mode, many small frames rather than a
batched stream), the fallback is to have the panel connect the same
`hakka-core` `NetworkRequest` records directly to `ws://localhost:8989`
instead, reusing `hakka-react-native`'s existing `HakkaBridge`/desktop wire
protocol (`{ type: 'request', payload }` frames, see
`hakka-react-native/src/core/HakkaBridge.ts`). That fallback is _not_
implemented here: flagging it as the documented escape hatch rather than
building it speculatively.

**Did `@rozenite/network-activity-plugin` reveal a better transport
pattern?** Read its RN-side wiring
(`packages/network-activity-plugin/src/react-native/events-listener.ts`)
looking for one, specifically. It sends one `client.send()` call per event:
same shape this package uses, no batching or debouncing anywhere in its
RN-side or shared code (checked). The one thing it has that this package's
`react-native/bridge.ts` doesn't is `EventsListener`: a bounded (200-item,
FIFO-drop-oldest) queue that buffers events captured _before_ the DevTools
client connects, so boot-time traffic isn't lost while the CDP domain is
still initializing. This package doesn't need an equivalent: `Hakka.getLogs()`
is already `hakka-react-native`'s own persistent capture store, independent
of whether any DevTools client has ever attached, so `createHakkaRozeniteBridge`
just reads it directly (`flushBacklog()`) the moment the client becomes ready
instead of maintaining a second, smaller-capacity duplicate buffer that could
drop events their own capture registry never would. Net: no transport change
adopted, because the one pattern worth considering turned out to solve a
problem this package's architecture doesn't have.

## Comparison with `@rozenite/network-activity-plugin`

Rozenite ships an official read-and-write network plugin. Worth an honest,
source-verified comparison rather than assuming this package is a strict
upgrade: it isn't, on every axis.

| Axis                   | `@rozenite/network-activity-plugin` (verified)                                                                                                                                                                                                                                    | `hakka-rozenite`                                                                                                                                                                                                                                                                                                                                                                                                                                          | Source                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Request list rendering | Renders every row directly: `table.getRowModel().rows.map(...)` over the full, unwindowed result set. No virtualization import anywhere in the 359-line file (`@tanstack/react-virtual`/`react-virtuoso` are dependencies of the package, but neither is used by this component). | `<hakka-request-list>` runs its own custom virtual-scroll window ("Flat virtualised view", `overscanPx`-based): DOM node count stays bounded regardless of how many requests have been captured.                                                                                                                                                                                                                                                          | `packages/network-activity-plugin/src/ui/components/RequestList.tsx:327`; `packages/hakka-browser/src/ui/RequestList.tsx`          |
| Filtering              | Checkbox/dropdown structured filters (`AdvancedFilterState`: methods, sources, status, domain, contentType, min/max size & duration) plus one plain substring text field. No scoped query syntax.                                                                                 | `hakka-core`'s scoped query DSL (`host:`, `header:`, `body:`, `status:`, `method:`, `dur>`, `size<`) via `<hakka-filter-bar>`, on top of the same kind of structured facets.                                                                                                                                                                                                                                                                              | `packages/network-activity-plugin/src/ui/state/filter.ts`; `packages/hakka-browser/src/ui/elements/filter-bar.tsx`'s `SCOPE_HINTS` |
| Response mutation      | **Ships a real, working per-request response override today**: edit status/body, `actions.addOverride(url, { status, body })`. This is write capability already in production, not a gap.                                                                                         | **Not yet wired into this plugin** (v0.1.0 is read-only). `hakka-core` already has a full `mockEngine`/`ThrottleEngine` used elsewhere across the Hakka ecosystem (`hakka-react-native`'s Mocks/Throttle panels, `hakka mcp`'s `create_mock` tool): bringing that into this panel over the same `control`-message channel `HakkaBridge`/`hakka mcp` already use is the natural next step, but it isn't built here. Noted as a real gap, not glossed over. | `packages/network-activity-plugin/src/ui/components/OverrideResponse.tsx`                                                          |
| Response body viewer   | Also has a JSON tree (`components/JsonTree.tsx`), wired into its JSON response renderer and WS/SSE message tabs.                                                                                                                                                                  | `<hakka-request-detail>` has its own JSON viewer too.                                                                                                                                                                                                                                                                                                                                                                                                     | Verified on both sides: parity, not a differentiator either way                                                                    |
| Theming                | shadcn-style default palette. Dark mode is literally 0%-saturation grayscale (`--background: 0 0% 3.9%`, `--foreground: 0 0% 98%`), generic devtools gray.                                                                                                                        | Wok Hei design tokens: a warm, non-gray accent (`#E0761A` light theme / `#FF9500` dark theme) plus a full bg/surface/border/text scale, shared with the rest of the Hakka product line.                                                                                                                                                                                                                                                                   | `packages/network-activity-plugin/src/ui/globals.css`; `packages/hakka-browser/src/ui/presets.ts`                                  |
| RN -> panel transport  | One `client.send()` per event; a bounded 200-item FIFO-drop-oldest pre-connect queue.                                                                                                                                                                                             | Same one-event-per-frame shape; no separate pre-connect queue: `Hakka.getLogs()` already the durable backlog (see above).                                                                                                                                                                                                                                                                                                                                 | `packages/network-activity-plugin/src/react-native/events-listener.ts`; `hakka-rozenite/src/react-native/bridge.ts`                |

## Architecture

```
hakka-rozenite/
├── rozenite.config.ts        # one panel: src/ui/App.tsx
├── vite.config.ts            # rozenitePlugin(), drives `rozenite build`/`dev`
├── react-native.ts           # lazy RN entry point (no-op in prod/web/SSR)
└── src/
    ├── shared/
    │   └── protocol.ts        # HAKKA_ROZENITE_PLUGIN_ID + HakkaRozeniteEventMap
    ├── react-native/
    │   ├── bridge.ts           # createHakkaRozeniteBridge (pure, unit-tested)
    │   ├── bridge.test.ts
    │   └── useHakkaRozeniteDevTools.ts   # thin hook: real client + real Hakka
    └── ui/
        ├── App.tsx             # the panel (FilterBar + RequestList + RequestDetail)
        ├── App.test.tsx
        ├── panelStore.ts       # store adapter fed by client messages
        └── panelStore.test.ts
```

**RN side** (`useHakkaRozeniteDevTools()`; call once, alongside `useHakka()`):
gets a Rozenite client, then `createHakkaRozeniteBridge` flushes `Hakka
.getLogs()` as individual `request` frames, subscribes to `Hakka.onRequest`
for live ones, and answers the panel's `get-snapshot`/`clear` messages.
Imports `Hakka` straight from `hakka-core`, the same thing
`hakka-react-native`'s own `HakkaBridge.ts` does for its desktop-bridge
integration, rather than through `hakka-react-native`'s `./index` re-export.

**Panel side** (`App.tsx`): gets a Rozenite client, builds a `panelStore`
(`ui/panelStore.ts`) that mirrors incoming `request`/`cleared` frames into a
`getSnapshot()`/`subscribe()`/`clear()`/`ingest()` shape, and passes that
same store into both `<FilterBar store>` (host-suggestion ranking) and
`<RequestList store>` (the actual capture mirror) from `hakka-browser/react`; those
two wire together automatically via `hakka-browser/elements`' shared
`FilterViewModel`/`SelectionViewModel` singletons, the same "two elements on
one page share state with zero configuration" behavior documented in
`hakka-browser/elements`' own README. Selecting a row passes the resolved
`NetworkRequest` object directly into `<RequestDetail request>`, bypassing
`hakka-browser/elements`' `request-id`-against-shared-store resolution entirely,
since this plugin's store is never `hakka-browser/elements`' own default
(`hakka-browser`-worker-backed) singleton.

## Setup

```ts
// In your app, alongside useHakka():
import { useHakkaRozeniteDevTools } from 'hakka-rozenite'

function App() {
  useHakka()
  useHakkaRozeniteDevTools()
  // ...
}
```

Requires Rozenite configured in the app's Metro/Re.Pack config (see
[Rozenite's own quick start](https://rozenite.dev/docs/getting-started)):
this package doesn't configure that for you, the same way every other
Rozenite plugin doesn't.

The repository's bare React Native example is a working reference. Its Metro
configuration enables `@rozenite/metro` when `WITH_ROZENITE=true` and limits
discovery to `hakka-rozenite`; `bun run start:rozenite` sets the matching
development-mode environment.

## Verification status

Three tiers, from "runs in a test sandbox" to "runs on a real device." The
no-device reproduction steps are in [`examples/`](./examples).

### 1. Unit-tested

`bun run --cwd packages/hakka-rozenite test` uses happy-dom + vitest, 20/20
passing:

- `react-native/bridge.test.ts`: the pure backlog-flush/live-forward/
  `get-snapshot`/`clear` wiring, against a fake Rozenite client and a fake
  `Hakka` facade. No real RN, no real Rozenite channel.
- `ui/panelStore.test.ts`: the store adapter's upsert-by-id mirroring,
  subscriber fan-out, `clear()`/`ingest()`/`destroy()` behavior, against a
  fake client.
- `ui/App.test.tsx`: mounts the real panel component with
  `@rozenite/plugin-bridge`'s `useRozeniteDevToolsClient` mocked (its real
  channel needs a CDP domain or a `postMessage`-connected parent frame,
  neither of which exists under happy-dom). Verifies the connecting state,
  that all three custom elements mount and register, that selecting a row in
  the list shows it in the detail pane, and that unmounting tears down the
  store's message-listener subscriptions.
- `shared/rozeniteTransport.test.ts`: connects the real Rozenite 2.4 plugin
  clients through `@rozenite/testing`; verifies captured traffic reaches the
  panel store and the panel's clear control reaches the RN-side bridge.

### 2. Verified 2026-09-05 without a device: build output, transport, and Metro discovery

Checked against the installed Rozenite `2.4.0` family and Vite `7.3.6`.

**Build output matches Rozenite's real discovery mechanism.**
`bun run --cwd packages/hakka-rozenite build` succeeds and produces
`dist/rozenite.json` with the Hakka panel and React Native integration next to
`dist/devtools/App.html`, `dist/react-native/react-native.{js,d.ts}`, and the
CommonJS device entry under `dist/react-native/cjs/`.
`@rozenite/middleware`'s own plugin discovery (`tryExtractPlugin` in its
published `dist/index.js`) is exactly `fs.accessSync(path.join(packagePath,
'dist', 'rozenite.json'))` against every package name in the host app's
`dependencies`/`devDependencies` that `require.resolve`s to a path under this
package's root, matching this build's output exactly, field for field.

**The compiled panel runs and round-trips real Rozenite protocol messages,
live, in a real browser.** `rozenite dev`'s no-device harness (`bun run
--cwd packages/hakka-rozenite dev`; `vite dev` on `:8888` under
`VITE_ROZENITE_TARGET=client`) serves the actual compiled
`dist/devtools/App.html` inside `@rozenite/vite-plugin`'s "Dev Host", a page
that stands in for React Native DevTools by loading the panel into an iframe
and letting you hand-dispatch messages over the exact wire protocol
(`@rozenite/plugin-bridge`'s `window.postMessage({pluginId, type, payload})`
transport, confirmed by reading its published `dist/index.js`). Driven in a
real browser tab:

- The panel mounted cleanly (zero console errors, zero server errors) and
  rendered the real Wok Hei-themed `<hakka-request-list>`/`<hakka-filter-bar>`
  from `hakka-browser/elements`, not a mock.
- "Load sample traffic" populated ~11 rows with correct method colors,
  status-code styling, and duration/size formatting; selecting a row opened
  the real `<hakka-request-detail>` pane (Overview/Request/Response/Timing
  tabs, Copy/Replay/Mock actions).
- Hand-dispatching a `request` message shaped exactly like
  `createHakkaRozeniteBridge`'s real payload,
  `{"id":"manual-verify-1","url":"https://api.example.com/v1/manual-dispatch-test","method":"GET","status":200,"startTime":1735000000000,"endTime":1735000000123,"duration":123,"size":512,"contentType":"application/json"}`,
  into the panel produced a correctly rendered row within one message. This
  is the actual RN -> panel production data path (`bridge.ts`'s
  `client.send('request', request)`, `panelStore.ts`'s
  `client.onMessage('request', upsert)`), exercised end-to-end against the
  real compiled artifact and the real transport, not a unit-test mock.

**The old no-device snapshot flow is fixed.** Rozenite 2 replaces the
short-lived listener API with typed `waitForMessage`. The current flow waits
for the panel's `get-snapshot` message and responds with a sample request.

### 3. Verified 2026-09-05 in React Native DevTools on an iOS Simulator

The React Native 0.86 example was built and installed on an iPhone 17
Simulator, connected to its Rozenite-enabled Metro server, and opened in React
Native DevTools. The app started native capture and displayed eight captured
requests. Rozenite mounted `hakka-rozenite: Hakka` from
`http://localhost:8888/devtools/App.html` in its sidebar. This run also found
and fixed an iOS event-emitter mismatch that previously crashed startup when
the shared engine subscribed to `onHakkaConsole` and `onHakkaStorage`.

The real Rozenite transport test covers request delivery and the Clear command
in both directions, while the simulator run covers native startup, capture,
Metro integration, plugin discovery, and panel mounting. Sustained production
traffic volume remains a benchmark candidate; it is not a setup or protocol
gap.

**Reproduction steps:**

1. From the repository root, run
   `bun run --cwd packages/hakka-react-native/examples/react-native-example start:rozenite`.
2. Build and open that example on a simulator or device.
3. Open React Native DevTools; confirm a "Hakka" panel appears in the sidebar.
4. Trigger some network requests in the app; confirm they appear in the
   panel's request list live. (The panel/detail-pane/filter-bar behavior
   itself is already confirmed (see tier 2 above); this step is about the
   device-side CDP transport delivering them.)
5. Click "Clear" in the panel; confirm `Hakka.getLogCount()` in the app goes
   to zero too (not just the panel's own view).

## Known limitations

- **`<RequestList>`'s "Load sample traffic" empty-state action only updates
  the panel's own local mirror.** This plugin has no synthetic demo-data
  source (all real traffic comes from the live device), so `ingest()` on
  the store adapter never forwards anything back to the device. Documented
  in `ui/panelStore.ts`'s own doc comment.
- **No batching.** Every captured request is sent as its own
  `client.send('request', ...)` call, mirroring
  `hakka-react-native`'s own desktop-bridge behavior exactly (one frame per
  request, no batch envelope) rather than introducing a new wire shape. If
  the "Data path" section's volume concern turns out to be real in practice,
  batching frames is one of the first things to try before falling back to
  the bridge-hub escape hatch.
