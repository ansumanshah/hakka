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

The Node runner sends HTTP/HTTPS requests, including GraphQL bodies, raw bodies, URL-encoded forms, query parameters, inherited headers, basic/bearer/API-key auth, response assertions, response captures, redirects, and per-request or `--timeout-ms` timeouts.

It writes privacy-safe JSON and JUnit reports with request names, status, timing, and assertion/error summaries. Request/response bodies, headers, environment values, and captured values are deliberately omitted from console output and reports.

The runner refuses features it cannot faithfully run: JavaScript hooks, multipart/file bodies, OAuth flows, WebSocket/SSE sessions, and gRPC. Use the desktop app for those authored request types; a failed portable run is never reported as a pass.

## Example collection

[`examples/api-automation`](https://github.com/ansumanshah/hakka/tree/main/examples/api-automation) contains a collection whose first request captures an ID and whose second request interpolates it. Run it against a local API by replacing `BASE_URL`.
