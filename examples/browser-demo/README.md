# hakka-browser demo

A single, build-free HTML page that drops `hakka-browser` into a host page and lets you generate
real traffic against it, click by click. It's the same drop-in `<script>` pattern the package's
own README leads with, just wired up with buttons instead of a blank page.

## Run it

Build the package first (this demo loads the built bundle from `../../packages/hakka-browser/dist`, not the TypeScript
source):

```bash
just build-browser
```

Then serve the **repository root**, not the example folder itself. The
page loads `../../packages/hakka-browser/dist/*` relative to its own URL:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/examples/browser-demo/index.html`. Don't open it as a `file://` URL: the module Worker
(`new Worker('./traced-worker.js', { type: 'module' })`) and the store's own Worker won't init
without a real origin.

## What it shows

The inspector opens automatically (`overlay: true`) so the panel is visible the moment the page
loads. It covers most of the viewport at first, which is the mobile-first bottom sheet doing its
job. Tap the **X** in the panel header (or the pill it collapses to) to get the page's buttons
back, click a few, then reopen the panel to watch the results land.

- **A handful of seed requests.** Four hand-authored records go straight into the store via
  `Hakka.ingest()` at load, so the Network list isn't empty on first paint: a JSON response, an
  auth POST, a 500 error, and a GraphQL operation. These are clearly synthetic (no `timing` data
  attached) and exist for offline browsing, not as a claim that they were actually captured.
- **Real fetch / XHR**, same-origin, through the real interceptor. `resourceTiming: true` means
  these get enriched with real DNS/TLS/connect/TTFB from the browser's own Performance Timeline.
  Open a captured row's Timing tab. On `localhost` dns/connect/tls often round to 0 (no real
  lookup or handshake to measure); ttfb and download still show real numbers. The "Fetch JSON"
  button also prints the captured `timing` object to the on-page log so you can see it without
  opening the panel.
- **Why `<img>`/`<script>` aren't a Resource Timing demo.** hakka-browser only reads
  `fetch`/`xmlhttprequest` initiator types off the Performance Timeline (see
  `src/capture/resourceTiming.ts`). A plain image or script tag load isn't request-shaped, so it
  never becomes a Network row. The "Load image + script" button still fires two real loads (check
  your own devtools Network tab, not Hakka's) so the boundary is visible instead of assumed.
- **`navigator.sendBeacon`**, real, `captureBeacons: true`. Lands in the Network list tagged
  `sendBeacon`.
- **WebSocket.** No WS server backs this demo, so the connection itself fails. The interceptor
  still records the attempt the instant `new WebSocket()` runs, so it shows up with a Frames tab
  regardless. Point `hakka-browser` at a real endpoint in your own app to see live frames.
- **The Worker store.** Capture (dedup, retention, filter/search, HAR/OTel serialization) runs off
  the main thread. `Hakka.getLogs()` and `Hakka.getBody('r1')` are separate round trips to that
  Worker; the buttons call them directly and print what comes back.
- **Rules, Mock.** `Hakka.mockEngine.addRule(...)` registers a rule for `GET /mock/users` on load;
  the button fetches it and never touches the network.
- **Rules, Throttle.** Toggles `Hakka.ThrottleEngine` between the Slow 3G preset and off. Turn it
  on, then fire one of the fetch buttons again: the delay is real.
- **Rules, Breakpoints.** Registers a breakpoint on `/breakpoint-demo`. The button's `fetch()`
  pauses before it's sent; the overlay auto-opens on Rules → Breakpoints so you can inspect, edit,
  and Resume/Abort it. The pending promise stays unsettled until you do.
- **Trace propagation.** `trace: true` is on, so same-origin requests carry a real
  `x-hakka-trace` header, visible on any captured row's Request Headers tab (or on a paused
  breakpoint's headers). Pair with `hakka-node` on your API server to group the client hop with
  the server work it triggers under one Trace.
- **JSON tree + body search.** Any JSON response (the seed data, or the real
  `assets/sample-data.json` fetch) renders as a tree in the Response tab. The real fetch's body
  has a nested string, `search for me in the body search box`, to try the in-body search on.
- **Export.** Once you've generated a few requests, use the panel header's Export control (a kebab
  menu on narrow viewports) for HAR 1.2 or OpenTelemetry JSON.
- **Logs.** The console button fires a log/warn/error trio, visible in the Logs tab.

## What's deliberately not here

- **Standalone elements** (`hakka-browser/elements/*`) and the **React wrapper**
  (`hakka-browser/react`) aren't demonstrated on this page. It's specifically the build-free
  `<script>` drop-in, and mixing in a bundler-driven React tree would defeat that. They're proven
  by `e2e/components-standalone.spec.ts` and `e2e/fixtures/components-standalone.html`.
- **The Vite/webpack/rspack plugins** (`hakka-browser/vite`, `/webpack`, `/rspack`) need their own
  bundler config to demonstrate meaningfully. Out of scope for a single static HTML page.

## Testing

Two specs exercise this page directly:

- `e2e/inspector.mobile.spec.ts` drives it on a Pixel 5 profile and asserts on the seed data
  specifically: the `/users/42` row (145ms, under the 300ms range-filter threshold) and the
  `/auth/login` row (320ms, over it). If you touch the seed block in `index.html`, keep those two
  shapes or update the spec alongside it.
- `e2e/overlay-mount.spec.ts` proves the built overlay actually mounts on the plain-`<script>`-tag
  path: `<hakka-inspector>` is a real, upgraded custom element (a shadow root with a rendered
  panel inside it, not just markup) and mounting it produced no console errors/warnings or
  uncaught page errors.

`just test-e2e` (from the repo root) runs both of these plus `components-standalone.spec.ts` —
the full **functional** e2e suite, all behavioral assertions, none of them wall-clock budgets.
Run just one spec from `packages/hakka-browser`:

```bash
bunx playwright test e2e/inspector.mobile.spec.ts
```

`scale-10k.spec.ts`, `render-bench.spec.ts`, and `overlay-open-latency.spec.ts` assert on
wall-clock budgets and go flaky under CPU contention, so they live behind `just bench-e2e`
instead — a separate, advisory recipe, never part of `just test-e2e`. A failure there tells you
nothing about this page.
