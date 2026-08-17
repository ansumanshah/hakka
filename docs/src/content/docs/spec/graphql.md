---
title: GraphQL
description: Spec card — operation-name/type detection for POST requests carrying a GraphQL body.
---

## What it does

The fetch/XHR interceptors detect a GraphQL operation on any POST body containing a `"query"`
key, extract the operation type (`query`/`mutation`/`subscription`) and name, and attach it to
the captured `NetworkRequest` as `graphql: GraphQLInfo`. Detail panels use this to label and
group GraphQL traffic instead of showing a bare `POST /graphql`.

## Public API

```ts
import { extractGraphQLOperationName, getRequestDisplayName } from 'hakka-core'
import type { GraphQLInfo } from 'hakka-core'

extractGraphQLOperationName(url, body?, headers?) // string | null
getRequestDisplayName(url, body?, headers?) // e.g. "GraphQL: GetUser" or the URL path
```

```ts
interface GraphQLInfo {
  operationName?: string
  operationType: 'query' | 'mutation' | 'subscription'
  variables?: Record<string, unknown>
}
```

Extraction runs in two places: `extractGraphQLOperationName`/`getRequestDisplayName` (standalone
utilities, URL-substring heuristic: `/graphql` in the URL or an `application/graphql`
content-type) and an internal `extractGraphQLInfoFromParsed` inside the fetch interceptor
(stricter: requires a `"query"` string field matching `/^\s*(query|mutation|subscription)\b/i`).
The interceptor's version is what populates `NetworkRequest.graphql`.

## Config keys + defaults

None — GraphQL detection is unconditional whenever a POST body contains a `"query"` key. There
is no config flag to disable it independently of capture itself.

## Platform matrix

SPEC §5 row "GraphQL detail":

| Capability     | RN  | iOS | Android | Web |
| -------------- | --- | --- | ------- | --- |
| GraphQL detail | ●   | ●   | ●       | ●   |

## Wire format

`NetworkRequest.graphql` is attached inline on the record — no separate frame. A redacted
request body still yields correct `graphql` metadata: extraction runs against the
post-redaction parsed value, so a redacted `query`/`operationName`/`variables` field never leaks
its real value into the summary.

## Test anchors

- `packages/hakka-core/src/utils/graphql.test.ts`
- `packages/hakka-core/src/capture/rewrite.test.ts` (re-derives GraphQL info for rewritten requests)

## Limits & non-goals

- Detection is POST-only; GraphQL over GET (persisted queries in query params) is not detected.
- No GraphQL-specific mocking, batching detection, or subscription (WebSocket) operation
  parsing — WebSocket GraphQL traffic (`graphql-ws` sub-protocol) is a separate feature, see
  [WebSocket](/spec/websocket/).
- `extractGraphQLOperationName`'s URL heuristic (`url.includes('graphql')`) is looser than the
  interceptor's own body-based check — the two can disagree on a request whose URL doesn't
  mention "graphql" but whose body is a GraphQL operation (the interceptor still tags it
  correctly; the standalone utility would not).
