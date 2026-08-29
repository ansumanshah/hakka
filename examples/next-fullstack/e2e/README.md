# next-fullstack e2e

Five Playwright tests against a real browser and a real `next dev`. They exist to cover the one
thing the ~4,200 unit tests elsewhere in this repo cannot: does the overlay actually mount, and
does a real click produce the client + server rows this example's README claims?

That gap is not hypothetical. Three bugs shipped past a green unit suite this cycle, each because
a test asserted on an intermediate artifact instead of observable behaviour: the Vite plugin
injected a script tag into the served HTML that never started the overlay, the RN SDK could not be
Metro-bundled at all, and the iOS demo compiled but never launched. Everything here drives the
rendered UI.

## Running

The example consumes `hakka-browser` and `hakka-node` through `file:` deps that point at their
built `dist/`, so build those first or `next dev` boots against stale or missing output:

```bash
just build-core build-bridge build-node build-browser
```

Then, from this directory:

```bash
npx playwright test
```

Or from the repo root, which does the builds for you:

```bash
just test-e2e-next
```

## Things that will bite you when writing a test here

**Scope row locators to `.hakka-list`.** `.hakka-row` is rendered by the detail pane too (under
`.hakka-detail-rowback`, as the correlated back-reference to the request being viewed). An
unscoped `.hakka-row` matches both, which produces two failures that look like product bugs and
are not: a path present in both places resolves to two elements and fails strict mode, and a
runtime filter looks leaky because the detail pane still shows the correlated server hop while the
list beside it is filtered correctly. Use `rowByPath` / `rowByHost` from `helpers.ts`; both scope
for you.

**A fresh browser context is not a fresh request list.** `hakka-node`'s embedded bridge hub buffers
captures server-side and replays them to every overlay that connects, so rows from earlier tests
in the same run arrive the moment this test's overlay mounts. Call `clearRequests` after opening.

**The bootstrap launcher is one-shot.** `hakka-browser` renders a plain `<button aria-label="Open
Hakka inspector">` before the Solid UI chunk loads, and removes it for good the first time the
panel closes. Use `openInspector` once per page load and `reopenInspector` (Shift+Enter on
`.hakka-toggle`) after any `closeInspector`.

**The panel reopens on the tab it was left on.** A test that visited Rules and then reopens is
still on Rules, where `.hakka-list` does not exist at all — a row assertion there fails with
"element not found", which reads as a missing badge rather than a wrong tab. Click the Network tab
before asserting on rows.

**Serial, one worker, on purpose.** Every test shares the one `next dev` instance `webServer`
starts. Concurrent first-hits to different routes raced Turbopack's on-demand compilation badly
enough to produce a transient "Module not found: hakka-node/next/client" and a client-side
double-fetch downstream of it.

**Route compilation is warmed in `global-setup.ts`**, not absorbed by test timeouts, so a test that
exceeds 30s is a real hang rather than a cold build.
