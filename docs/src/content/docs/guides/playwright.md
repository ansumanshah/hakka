---
title: From Hakka to Playwright routes
description: Turn captured traffic into a Playwright page.route() mock module for your E2E suite.
---

`hakka-core` converts captured `NetworkRequest`s into a Playwright route-mock module —
`toPlaywrightRoutes(requests, opts?)` — the direct sibling of [`buildMswHandlers`](/guides/msw/)
for Playwright's own [`page.route`](https://playwright.dev/docs/api/class-page#page-route) /
[`route.fulfill`](https://playwright.dev/docs/api/class-route#route-fulfill) mocking.

Export direction only — there is no import/parse direction here, unlike the MSW interop's
`parseMswHandlers`.

## Record traffic, paste into your test suite

```ts
import { toPlaywrightRoutes } from 'hakka-core'
import { Hakka } from 'hakka-react-native' // or hakka-browser / hakka-node/next

const source = toPlaywrightRoutes(Hakka.getLogs())
console.log(source)
```

Output:

```ts
import type { Page } from '@playwright/test'

export async function mockRoutes(page: Page) {
  // https://api.example.com
  await page.route('https://api.example.com/v1/users', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200,
      json: { users: [] },
    })
  })
}
```

Call `mockRoutes(page)` in your test setup before navigating.

**What gets emitted, and why**

- **Grouped by origin**, each group under a `// <origin>` comment — same reading order as the
  MSW export.
- **Deduped by method + pathname**, newest capture wins.
- **A response body over 10 KB is truncated** and flagged with a comment inside the `fulfill`
  block, the same rule as the MSW export.
- Requests with neither a `status` nor a `responseBody` are skipped — there's nothing to replay.

**Options**

```ts
toPlaywrightRoutes(requests, {
  exportName: 'mockRoutes', // export async function <exportName>(page: Page)
  maxBodyBytes: 10 * 1024, // truncation threshold
})
```

## Why every handler starts with a method guard

`page.route(url, handler)` matches purely on URL — unlike MSW's `http.get`/`http.post`/etc.,
there is no per-method registration. Per the Playwright docs, "if a request matches multiple
registered routes, the most recently registered route takes precedence." Two requests captured
against the same pathname but different methods (`GET /v1/users` and `POST /v1/users`) would
naively produce two `page.route` calls for the same URL, with the later one silently shadowing
the earlier one for _every_ method that hits that URL.

Every generated handler therefore opens with a method guard:

```ts
await page.route('https://api.example.com/v1/users', async (route) => {
  if (route.request().method() !== 'GET') return route.fallback()
  // ...
})
```

so two routes registered for the same URL coexist correctly — a non-matching method falls
through to whatever else would have handled it — instead of one route quietly eating the other.

## The query string is dropped, same as MSW

URL matching mirrors the MSW export: origin + pathname only, query string dropped. Playwright's
plain-string route patterns are glob-matched, and a captured query string is neither useful to
match on (Playwright would treat it as a literal glob segment) nor safe to embed verbatim. If you
need to distinguish `?page=1` from `?page=2`, read `route.request().url()` inside a real handler.

## Redaction is a capture-time concern

Response headers are carried over verbatim from `req.responseHeaders`, minus `content-length`,
`content-encoding`, and `transfer-encoding` (those describe the original transport, not the
literal string re-embedded here). Whatever the capture pipeline already redacted (see
[`redactHeaders`](/core/overview/#hakkaconfig-options)) stays redacted; whatever it didn't, this
module will faithfully reproduce, secrets included. There's no second redaction pass at codegen
time — turn on header/body redaction before recording if the traffic you're exporting is
sensitive.

## Next steps

- [From Hakka to MSW and back](/guides/msw/) — the MSW-flavored sibling of this export.
- [Test helpers](/testing/overview/) — assert on requests once your Playwright mocks are wired up.
