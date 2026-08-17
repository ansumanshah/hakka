---
title: Test Helpers
description: Framework-agnostic utilities for asserting on captured network requests in any test runner.
---

`hakka-core/test` provides a capture harness, request finders, and fluent matchers
for working with `NetworkRequest` logs from `hakka-core`. It has no dependency
on any specific test framework — Bun, Vitest, Jest, and `node:test` all work.

## Install

```sh
npm install -D hakka-core
# or
bun add -D hakka-core
```

## Capture harness

### `captureWith`

Clears the Hakka log, runs an async function, then returns everything captured
during that call.

```ts
import { captureWith, expectRequest } from 'hakka-core/test'

const { requests } = await captureWith(hakka, async () => {
  await fetch('https://api.example.com/users')
})
```

The first argument must implement `HakkaLike` — `getLogs()` and `clearLogs()`.
Pass your real Hakka instance or a compatible stub.

**Options**

| Option    | Type     | Default | Description                                                                                            |
| --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `flushMs` | `number` | `0`     | Extra milliseconds to wait after `fn()` resolves before collecting logs. Useful when capture is async. |

### `captureFromProvider`

Use this when you already have a log snapshot and do not need a running Hakka
instance.

```ts
import { captureFromProvider } from 'hakka-core/test'

const { requests } = await captureFromProvider(() => Hakka.getLogs())
```

An optional second argument `fn` runs before the provider is called.

## Finding requests

```ts
import { findRequest, filterRequests } from 'hakka-core/test'

// First match, or undefined
const login = findRequest(requests, { url: '/auth/login', method: 'POST' })

// All matches
const gets = filterRequests(requests, { method: 'GET' })
```

Both functions accept a `RequestFilter`. All fields are optional and AND-ed:

| Field         | Type      | Matching                                                                        |
| ------------- | --------- | ------------------------------------------------------------------------------- |
| `url`         | `string`  | Substring match against `request.url`                                           |
| `method`      | `string`  | Case-insensitive exact match                                                    |
| `status`      | `number`  | Exact HTTP status code                                                          |
| `contentType` | `string`  | Substring match against `content-type` response header or `request.contentType` |
| `mocked`      | `boolean` | Whether intercepted by MockEngine                                               |

`matchesFilter(request, filter)` is also exported for custom filter logic.

## Fluent matchers

`expectRequest` returns a `RequestMatcher` that resolves a matching request on
the first chained assertion and re-uses it for every subsequent assertion.

```ts
import { expectRequest } from 'hakka-core/test'

expectRequest(requests)
  .toHaveBeenCalledWith({ method: 'POST', url: '/api/login' })
  .withStatus(200)
  .withResponseHeader('content-type', 'application/json')
  .withBodyContaining('"token"')
```

A filter passed to `expectRequest` itself is merged with the filter in
`toHaveBeenCalledWith`.

**`RequestMatcher` methods**

| Method                              | Description                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `.toHaveBeenCalledWith(filter)`     | Assert a matching request was captured; narrows the resolved request |
| `.notToHaveBeenCalled()`            | Assert no matching request was captured (terminates the chain)       |
| `.withStatus(code)`                 | Assert exact HTTP status code                                        |
| `.withBody(str)`                    | Assert response body equals `str` exactly                            |
| `.withBodyContaining(str)`          | Assert response body contains `str`                                  |
| `.withResponseHeader(name, value?)` | Assert response header exists; optionally assert its value           |
| `.withRequestHeader(name, value?)`  | Assert request header exists; optionally assert its value            |
| `.withRequestBody(str)`             | Assert request body equals `str` exactly                             |
| `.thatSucceeded()`                  | Assert no `error` field and status 2xx/3xx                           |
| `.thatFailed()`                     | Assert `error` field is set                                          |
| `.thatIsMocked()`                   | Assert intercepted by MockEngine                                     |
| `.get()`                            | Return the resolved `NetworkRequest` for further inspection          |

## Standalone assertions

All matchers are also available as individual functions. Use these when you
want to inspect a `NetworkRequest` you already hold.

**Log-level** (operate on `NetworkRequest[]`):

```ts
import { assertRequestMade, assertRequestNotMade, assertRequestCount } from 'hakka-core/test'

assertRequestMade(requests, { url: '/users', method: 'GET' })
assertRequestNotMade(requests, { url: 'analytics.example.com' })
assertRequestCount(requests, { method: 'POST' }, 1)
```

**Request-level** (operate on a single `NetworkRequest`):

```ts
import {
  assertStatus,
  assertBody,
  assertBodyContains,
  assertResponseHeader,
  assertRequestHeader,
  assertRequestBody,
  assertIsSuccess,
  assertIsError,
  assertIsMocked,
} from 'hakka-core/test'

assertStatus(request, 201)
assertBody(request, '{"ok":true}')
assertBodyContains(request, '"id"')
assertResponseHeader(request, 'content-type', 'application/json')
assertRequestHeader(request, 'authorization')
assertRequestBody(request, JSON.stringify({ email: 'a@b.com' }))
assertIsSuccess(request) // no error + 2xx/3xx
assertIsError(request) // error field present
assertIsMocked(request) // intercepted by MockEngine
```

All functions throw `HakkaAssertionError` (a subclass of `Error`) on failure
with a readable message that includes the URL, expected value, and actual value.

## Example test

```ts
import { describe, it } from 'vitest'
import { captureWith, expectRequest, assertRequestCount } from 'hakka-core/test'
import { hakka } from '../src/hakka'
import { loginUser } from '../src/auth'

describe('loginUser', () => {
  it('posts credentials and returns a token', async () => {
    const { requests } = await captureWith(hakka, () => loginUser('ada@example.com', 's3cr3t'))

    expectRequest(requests)
      .toHaveBeenCalledWith({ method: 'POST', url: '/api/auth/login' })
      .withStatus(200)
      .withResponseHeader('content-type', 'application/json')
      .withBodyContaining('"token"')

    // Only one auth request should fire
    assertRequestCount(requests, { url: '/api/auth' }, 1)
  })
})
```

## Codegen

### `generateTestFile`

Turn a captured session into a complete, runnable regression test file built
on the assertions above.

```ts
import { generateTestFile } from 'hakka-core/test'

const code = generateTestFile(requests, { framework: 'vitest', suiteName: 'Checkout flow' })
```

Requests are grouped one `describe` block per host, one `it` per request —
mirrors how a human would organize a suite from mixed traffic without extra
config. The generated assertions are deliberately shallow:

- **Response shape, not response values.** Only top-level JSON keys are
  asserted, not deep values — a snapshot of live traffic will legitimately
  drift on timestamps, counters, and ids, and asserting the shape still
  catches the failure mode this feature is for (e.g. "the endpoint stopped
  returning `total`") without breaking on churn.
- **Duration bounds are generous** — 10x the captured value — enough
  headroom to catch a real regression without flaking on normal variance.
- **Requests with no `status`** (pending or capture-truncated) are skipped,
  with a `// skipped:` comment left in their place so the generated file's
  request count is visibly reconciled against the input.

**Options**

| Option      | Type                          | Default                    | Description                           |
| ----------- | ----------------------------- | -------------------------- | ------------------------------------- |
| `suiteName` | `string`                      | `'Hakka captured session'` | Top-level `describe` suite name       |
| `framework` | `'vitest' \| 'bun' \| 'jest'` | `'vitest'`                 | Which test runner's globals to import |

## `HakkaAssertionError`

All failures throw `HakkaAssertionError` (exported from `hakka-core/test`). It
extends `Error` with `name === 'HakkaAssertionError'`, so you can narrow it
with `instanceof` if you need to distinguish assertion failures from other
errors in a catch block.
