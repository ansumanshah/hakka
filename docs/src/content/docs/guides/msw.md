---
title: From Hakka to MSW and back
description: Turn captured traffic into MSW v2 handlers for your test suite, and pull hand-written MSW handlers back into the Hakka Mock panel.
---

`hakka-core` converts between captured `NetworkRequest`s and [MSW](https://mswjs.io) v2
`http.<method>(path, resolver)` handlers, in both directions.

- `buildMswHandlers(requests, opts?)` — capture → a formatted `.ts` handlers module.
- `parseMswHandlers(source)` — a handlers module (or any string containing `http.<method>(...)`
  calls) → `MockRule[]` for `mockEngine`.

Both are static — no MSW dependency, no code execution. `buildMswHandlers` writes plain
strings; `parseMswHandlers` scans source text with a small bracket-balancing parser, not a TS
compiler.

## Record traffic, paste into your test suite

```ts
import { buildMswHandlers } from 'hakka-core'
import { Hakka } from 'hakka-react-native' // or hakka-browser / hakka-node/next

const source = buildMswHandlers(Hakka.getLogs())
console.log(source)
```

Output:

```ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  // https://api.example.com
  http.get('https://api.example.com/v1/users', () => HttpResponse.json({ users: [] }, { status: 200 })),
  http.post('https://api.example.com/v1/users', () => HttpResponse.json({ id: 42 }, { status: 201 })),
]
```

Paste that into a `handlers.ts` next to your tests and wire it up the normal MSW way
(`setupServer(...handlers)` in Node, `setupWorker(...handlers)` in the browser).

**What gets emitted, and why**

- **Grouped by origin**, each group under a `// <origin>` comment — reading order matches how
  you'd browse the Hakka request list.
- **Deduped by method + pathname**, newest capture wins. If you hit `GET /v1/users?page=1` and
  later `GET /v1/users?page=2`, only one handler comes out — see the query-string note below
  for why.
- **A response body over 10 KB is truncated** and flagged with a comment on the line above:

  ```ts
  // truncated: original body 48213 bytes, showing first 10240
  http.get('https://api.example.com/v1/big', () => HttpResponse.text('...', { status: 200 })),
  ```

  Truncated bodies always come out as `HttpResponse.text(...)`, even if the original was
  JSON — a cut-off object literal isn't valid syntax, a cut-off string always is.

- Requests with neither a `status` nor a `responseBody` (nothing captured yet, or captured
  mid-flight) are skipped — there's nothing to replay.

**Options**

```ts
buildMswHandlers(requests, {
  exportName: 'handlers', // export const <exportName> = [...]
  maxBodyBytes: 10 * 1024, // truncation threshold
})
```

### The query string is dropped on purpose

MSW compiles the path predicate through `path-to-regexp` and matches on origin + pathname —
the query string is stripped before matching (`getCleanUrl()` in MSW's own
`matchRequestUrl.ts`). A literal `?` in the pattern is also a `path-to-regexp` "optional
token" modifier, not a query separator, so embedding the query string would be actively
wrong, not just unused. Every handler here is `origin + pathname` only. If you need to
distinguish `?page=1` from `?page=2`, read `request.url` inside a real resolver — that's
outside what static codegen can do.

## Import MSW mocks into the Hakka overlay

```ts
import { parseMswHandlers, mockEngine } from 'hakka-core'
import { readFileSync } from 'node:fs'

const source = readFileSync('./mocks/handlers.ts', 'utf8')
const { rules, unsupported } = parseMswHandlers(source)

for (const rule of rules) mockEngine.addRule(rule)

if (unsupported.length > 0) {
  console.warn(`${unsupported.length} handler(s) need a manual mock rule:`, unsupported)
}
```

Each parsed handler becomes a `MockRule` — `mockEngine.addRule(rule)` registers it directly,
no conversion step. From here on it behaves like any other Mock panel rule: it shows up in
`mockEngine.getRules()`, matches through the normal `mock` mode path, and its `hitCount` ticks
up on every match.

### What parses, and what doesn't

`parseMswHandlers` handles one shape: a literal path, a parameter-less resolver, and a single
`HttpResponse.json(...)` or `HttpResponse.text(...)` call — as a concise arrow or a
single-`return` block:

```ts
// Parses
http.get('/api/users', () => HttpResponse.json({ users: [] }))
http.post('/api/users', () => HttpResponse.json({ id: 42 }, { status: 201 }))
http.get('/api/health', () => {
  return HttpResponse.text('ok', { status: 200 })
})
```

Anything that reads the request — the exact point of a "real" resolver — is outside static
analysis and gets reported, not silently dropped:

```ts
// Reported in `unsupported`, not in `rules`
http.get('/api/users/:id', ({ params }) => HttpResponse.json({ id: params.id }))
http.get('/api/search', ({ request }) => {
  const q = new URL(request.url).searchParams.get('q')
  return HttpResponse.json({ query: q })
})
http.get('/api/data', () => passthrough())
```

Each entry in `unsupported` carries the method, the path (recovered even when the resolver
itself isn't static), and a reason string that always starts with `unsupported: dynamic
resolver`:

```ts
type UnsupportedMswHandler = {
  method: string
  path: string
  reason: string // e.g. 'unsupported: dynamic resolver (resolver reads request/params/cookies)'
}
```

Treat `unsupported` as a todo list — those endpoints still need a hand-written `mockEngine.addRule(...)`
call (see [Mocking](/features/mocking/)) or a real MSW resolver, not a generated one.

## Round trip

`buildMswHandlers` output is designed to be exactly what `parseMswHandlers` recognizes, so a
capture survives the trip in full:

```ts
import { buildMswHandlers, parseMswHandlers, mockEngine } from 'hakka-core'

const source = buildMswHandlers(requests)
const { rules, unsupported } = parseMswHandlers(source)
// unsupported is empty — everything buildMswHandlers emits is in the static subset

for (const rule of rules) mockEngine.addRule(rule)

mockEngine.match('https://api.example.com/v1/users', 'GET')
// -> the rule built from the captured request, with the original status/body/headers
```

Response headers are carried over, minus `content-length`, `content-encoding`, and
`transfer-encoding` — those describe the original transport, not the literal string now
embedded in the handler, and would be actively wrong on the mocked response.

## Next steps

- [Mocking](/features/mocking/) — the full `mockEngine` API these rules feed into.
- [Test helpers](/testing/overview/) — assert on requests once your MSW mocks are wired up.
