---
title: Collection runner
description: Run Git-friendly Hakka API collections in CI.
---

`hakka run` executes the same `.hakka` request files that the desktop app stores: one request per file, `collection.hakka` at the root, and optional folders with `folder.hakka`. Requests use their saved `seq` ordering, with filename as the stable tie breaker. A folder run is depth-first.

```sh
hakka run ./api --env BASE_URL=https://api.example.test
hakka run ./api --folder smoke --data users.csv --repeat 3 --delay-ms 500
hakka run ./api --json-report artifacts/hakka.json --junit-report artifacts/hakka.xml
hakka run ./api --env BASE_URL=https://api.example.test --json
```

The command exits `0` only when every request transport succeeds and every enabled assertion passes. It exits `1` for a run failure and reports malformed files, missing variables, invalid options, and unsupported features as clear errors.

For an agent or another noninteractive caller, use `--json`. Standard output is then one stable JSON `RunReport`; it has counts and per-request names, status, duration, outcome, and assertion/error summaries, but never bodies, headers, or variable values. Combine it with `--json-report` or `--junit-report` when a CI system needs files too.

## Variables, captures, and datasets

Pass initial values with repeatable `--env NAME=value`. `{{NAME}}` is resolved once in URLs, headers, query values, supported bodies, and supported auth. An unresolved variable prevents that request from being sent. Response captures update the variables used by later requests in the same dataset iteration.

`--data` accepts either an array of JSON objects or a header-row CSV file. Each row is a separate sequential iteration; row fields override `--env` values. `--repeat` repeats the complete dataset (default `1`), and `--delay-ms` waits between iterations. Both are finite and bounded, so this is suitable for CI monitoring jobs rather than an unbounded process.

## Supported portable contract

The Node runner sends HTTP/HTTPS requests, including GraphQL bodies, raw bodies, URL-encoded forms, binary file bodies, and multipart form uploads. File paths are collection-relative; path escapes and uploads over 5 MiB are refused before a request is sent. It supports inherited headers, basic/bearer/API-key auth, OAuth2 static tokens, client-credentials, and refresh-token grants, response assertions, response captures, redirects, and per-request or `--timeout-ms` timeouts.

OAuth access and refreshed tokens stay in the run's in-memory variable scope. They are redacted from errors and reports. Authorization-code OAuth needs browser and loopback interaction, so `hakka run` refuses it explicitly as a noninteractive command.

Saved pre-request and post-response JavaScript hooks run in a fresh bounded worker. They receive the desktop-compatible `env`, `log`, `vars.set(name, value)`, and `request`/`response` contexts. A pre-request failure prevents sending; a post-response failure makes that request fail. Worker isolation limits lifetime and memory but is not presented as a security sandbox; do not execute untrusted collection hooks in CI.

It writes privacy-safe JSON and JUnit reports with request names, status, timing, and assertion/error summaries. Request/response bodies, headers, environment values, and captured values are deliberately omitted from console output and reports.

For finite streaming checks, `session` contains exactly one variant. A WebSocket session saves `sendFrames`, `maxFrames`, and `timeoutMs`; the runner sends those frames and succeeds only after receiving exactly `maxFrames`. An SSE session saves `maxEvents` and `timeoutMs`; it succeeds only after reading exactly that many complete event blocks. Their response body is a JSON object (`{ frames }` or `{ events }`), so ordinary JSON-path assertions and captures work. An early close or deadline is an error, never a partial pass.

`grpc://` and `grpcs://` URLs with a `{"grpcMessage":{"hex":"0801"}}` body run one raw unary HTTP/2 call. The body is hexadecimal or base64 protobuf bytes. The JSON response body contains the decoded protobuf message bytes as `messageBase64`, plus `grpcStatus` and `grpcMessage`; response headers also include `grpc-status`. Missing trailers, malformed framing, and oversized messages fail the run. Client/server/bidi streaming remains unsupported.

MCP and team-monitor runs disable executable JavaScript hooks before sending any request.
Local CLI runs permit hooks from collections you trust. The programmatic runner accepts
an `AbortSignal` for an overall collection deadline; it covers OAuth, hooks, transports,
and iteration delays.

```ts
import { runCollection } from 'hakka-cli/run'

const report = await runCollection('./api', {
  environment: { BASE_URL: 'http://127.0.0.1:4010' },
  signal: AbortSignal.timeout(60_000),
  allowScripts: false,
})
if (report.failed) process.exitCode = 1
```

## Example collection

[`examples/api-automation`](https://github.com/ansumanshah/hakka/tree/main/examples/api-automation) contains a collection whose first request captures an ID and whose second request interpolates it. Run it against a local API by replacing `BASE_URL`.

Collection loading rejects a format version newer than the supported version 4.
A directory without `folder.hakka` is outside the collection tree. A directory with
malformed `folder.hakka` fails the run before sending requests, so an invalid folder
cannot silently disappear from the test run.
