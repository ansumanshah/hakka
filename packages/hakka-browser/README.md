# hakka-browser

Network inspector overlay for **web browsers** — built for mobile web and anywhere devtools aren't available. Part of [Hakka](https://github.com/ansumanshah/hakka).

Captures `fetch` / `XHR` / `WebSocket` plus real **Resource Timing** (DNS/TLS/connect/TTFB), renders a Shadow-DOM overlay that never collides with your page's styles, and exports HAR + OpenTelemetry. Framework-agnostic — drop it into React, Vue, Svelte, Angular, or plain HTML.

Runs the **same `hakka-core` engine** as `hakka-react-native`, so captures are identical across platforms.

## What's inside

- **Network** — request list (virtualized), method/status/content-type filters that persist, detail view with headers, request/response bodies (JSON tree + in-body search), inline image preview, and a real timing waterfall.
- **GraphQL** — operation name/type surfaced in the row and detail; variables rendered as a tree.
- **WebSocket** — a Frames tab listing every frame (direction, payload, time).
- **Per-request actions** — copy as cURL / `fetch()` / text, native Share, and **Replay** (re-issue the request).
- **Rules** — Mock (intercept matching `fetch`/`XHR` and return a configured response), Throttle (Fast/Slow 3G, Edge, Offline), and request/response breakpoints, one tab with a segmented switch between the three.
- **Stats** — success/error rates, method + status distribution, duration p95, bytes, hosts.
- **Logs / Storage** — console capture, localStorage/sessionStorage/cookies.
- **Settings** — ring-buffer capacity, retention, redaction, desktop bridge, and the browser/OS/viewport environment info the old Info tab used to own.
- **Export** — HAR 1.2 (with real timing) and OpenTelemetry JSON; live stream to the Hakka desktop app.

## Runs in a Web Worker

Capture interceptors stay on the main thread (that's where `fetch`/XHR/WebSocket live), but the **store, dedup, retention, filter/search, HAR/OTel serialization, and the desktop-bridge socket all run in a Web Worker** — so the always-on capture barely touches your app's thread. It falls back transparently to an in-process engine where Workers aren't available (SSR, locked-down hosts).

Measured main-thread overhead is **~7.7 µs/request** — about **5× lighter than vConsole** and **6.7× lighter** than running the same engine without the Worker (see `packages/hakka-bench/`, run `bun run --cwd packages/hakka-bench bench`).

## Use it

**Drop-in `<script>` (no build step — ideal for mobile debugging):**

```html
<script async src="https://unpkg.com/hakka-browser/dist/hakka-browser.global.js"></script>
<script>
  addEventListener('load', () => Hakka.start())
</script>
```

**npm (any framework):**

```bash
npm install hakka-browser
```

```ts
import { start } from 'hakka-browser'

start()
```

## Lazy by design

Only the **capture engine + a tiny launcher button (~2.4 KB gz)** load eagerly.
The inspector UI is a **separate async chunk** that is fetched **only when you open
the inspector** — it is never part of your app's main bundle. Interceptors are
transparent passthroughs and the overlay never intercepts the page's pointer events,
so Hakka does not disrupt the host page.

The overlay is the `<hakka-inspector>` custom element, rendered in a Shadow DOM.
`start({ overlay: false })` captures silently; call `Hakka.show()` from your own
debug trigger. To keep it out of production entirely, gate the import behind a dev
check (e.g. `if (import.meta.env.DEV) await import('hakka-browser').then(h => h.start())`).

## Responsive layout

Desktop widths get one single-line row per request (method, path, host, badges,
status, size, duration). Below the container-query breakpoint, the header
collapses to a tab-strip row plus a kebab menu for Clear/Export/Session/⌘K so
nothing clips, and the row itself drops to a two-line layout (path+host on one
line, duration/size stacked on the other). The filter bar's search field has an
ⓘ button next to it — a popover cheat-sheet for the search DSL (`url:`, `header:`,
`body:`, glob, regex, `-negate`) that links out to the full
[search DSL reference](https://hakka.noodleapps.com/spec/search-dsl/).

## License

MIT
