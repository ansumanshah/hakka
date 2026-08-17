# hakka-core

Platform-neutral network-capture engine for [Hakka](https://github.com/ansumanshah/hakka). Zero runtime dependencies, framework-agnostic.

This package is the shared engine consumed by:

- [`hakka-react-native`](../hakka-react-native) — React Native, with an injected native (OkHttp / URLProtocol) adapter
- [`hakka-browser`](../hakka-browser) — browsers, with Resource Timing + DOM adapters

## What's inside

- **Capture** — `fetch` / `XMLHttpRequest` / `WebSocket` / `console` interceptors
- **Storage** — bounded ring buffer with age-based retention
- **Mock engine** — request matching and canned responses
- **Throttle engine** — latency / offline simulation
- **Data model** — the `NetworkRequest` shape, the cross-platform record contract, and HAR + OpenTelemetry export

You usually don't install this directly — use `hakka-react-native` or `hakka-browser`.

## Test helpers (`hakka-core/test`)

A capture harness (`captureWith`), request finders
(`findRequest`/`filterRequests`), a fluent assertion matcher
(`expectRequest(...).toHaveBeenCalledWith(...)`), and a regression-test
codegen (`generateTestFile`) for working with captured `NetworkRequest[]` in
your own test suite. It's a **separate entry point**, not part of the
package root: `import { expectRequest } from 'hakka-core/test'`. This keeps
`hakka-core` itself importable into a production bundle with nothing
test-only along for the ride.

## License

MIT
