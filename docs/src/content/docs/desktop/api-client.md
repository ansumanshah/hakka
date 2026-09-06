---
title: The API client
description: Collections, environments, scripts, assertions, HTTP, GraphQL, gRPC, WebSocket, imports, code generation, and folder runs.
---

## Collections

Folders and requests, each request its own file. Headers and auth inherit collection
→ folder → request. See [Collections are files](/desktop/overview/#collections-are-files)
for how a collection is stored on disk, and why that shape was chosen.

## Environments

Named variable sets with `{{name}}` interpolation. A request that references a
variable with no value is refused rather than sent with the placeholder intact.

## Assertions and captures

Assertions are declarative checks on status, duration, headers, JSON paths, and body
text. Captures pull a value out of a response into a variable, so a login request
feeds the token to everything that runs after it. Both remain structured collection
data even when a request also uses JavaScript hooks.

## Scripts

Each saved HTTP request has a **Scripts** tab with pre-request and post-response
editors:

- **Pre-request** runs before variable resolution and sending. It can read the
  flattened environment, mutate the request's method, URL, headers, and raw-text
  body, and call `vars.set(name, value)`; variables it sets are available to that
  request's own `{{name}}` interpolation. A thrown, invalid, or timed-out script
  aborts the send before a request is built.
- **Post-response** runs after the response has been recorded. It can read the
  environment and response and use `vars.set(name, value)` to pass data to later
  requests. A failure appears inline under the editor without discarding the real
  response.

Scripts run in a fresh JavaScriptCore context with a five-second watchdog. The
available globals are deliberately small: `env`, `request` or `response`,
`vars.set(...)`, and `log(...)`. There is no `require`, package resolution,
filesystem, or network API. The current editor surfaces script errors inline but
does not provide a console for `log(...)` output.

Script source is stored one line per JSON array entry in the request's `.hakka`
file, keeping edits readable in Git.

## Import and code generation

Import reads cURL commands, Postman v2.1 collections, OpenAPI 3 documents, and HAR
(including Hakka's own export). Code generation writes a saved request back out as
cURL, JavaScript `fetch`, Swift `URLSession`, Python `requests`, Go `net/http`, or
HTTPie — each with a redacting mode so a snippet is safe to paste into a bug report.

## Folder runs

Running a folder sends every request nested under it, in order, against one shared
state — the mini collection runner every API client ships.

- **Captures carry forward.** Each request's resolved variable scope becomes the
  input to the next request's resolve, so a login request at the top of the folder
  supplies the token every later request in it interpolates.
- **One cookie jar for the whole run.** A fresh jar is created per run and shared by
  every request in it, so a `Set-Cookie` from request 2 rides on request 5's `Cookie`
  header. It is scoped to that run: it is never the jar a lone, ad hoc send uses, and
  a fresh jar per run means one folder run can't leak into another.
- **A failing request does not stop the run.** Every request in the plan is attempted
  regardless of what happened before it, and the summary records each outcome. Some
  API clients stop at the first failure; here that would hide whether requests 4
  through 10 are also broken, forcing several run-fix-run cycles to find every problem
  in a smoke suite instead of seeing them all in one pass. The trade is that a request
  downstream of a failed capture may itself fail resolution because its variable never
  got set — but that reports the same way as any other failure, so it reads as
  diagnostic signal, not noise.

## Editor depth

The request editor handles bodies beyond raw text and JSON: multipart form parts,
binary bodies, and a GraphQL body editor with query and variables. Auth supports
OAuth2 with three grant types — client credentials, refresh token, and authorization
code with PKCE — run through a local loopback listener for the redirect.

## Protocols

HTTP and GraphQL requests use the full request runner: inheritance, environment
resolution, scripts, assertions, captures, redirects, and cookies.

The current gRPC client is a unary raw-wire path. A `grpc://` or `grpcs://`
request accepts hex- or base64-encoded protobuf message bytes and supports inherited
metadata and variable resolution. Reflection-based message authoring, streaming,
scripts, assertions, captures, and OAuth2 refresh are not wired into this path yet.

A `ws://` or `wss://` request opens a separate WebSocket console. It connects and
disconnects, sends text frames, and shows sent and received frames plus connection
state. WebSocket sessions do not pass through the request runner, so request scripts,
assertions, captures, cookies, and folder runs do not apply to them.

## Cookies

A private cookie jar per run, so a session survives a login and nothing ever touches
your system cookie store. A `Cookie` header you set yourself always wins.
