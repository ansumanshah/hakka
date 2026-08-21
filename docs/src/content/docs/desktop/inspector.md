---
title: The inspector
description: Live traffic, filtering, body viewers, timing, WebSocket and gRPC frame inspection, LLM streams, diagnosis, diff, and export.
---

## Live traffic and filtering

Requests stream from your app over the bridge, on this Mac or a device on the same
network. The search bar accepts a small DSL on top of free text: `method:GET`,
`host:api.example.com`, `type:json`, `device:"Device 2"`, `dur>100` (milliseconds),
`size>1kb`, status ranges like `2xx` or `404`, and `sort:`/`order:` — a leading `-`
negates most of these. Filters you use often can be saved as presets. See
[Device attribution](/desktop/trace/#device-attribution) for what `device:` matches
against.

## Bodies

Content-type dispatch: a JSON tree with syntax highlighting and search, image
preview, hex dump, or plain text. A display cap keeps a huge body from freezing the
window.

**WebSocket frames** get their own console: a connection lifecycle banner plus every
frame sent and received, in order.

**gRPC frames** decode the length-prefixed protobuf messages inside a gRPC or
gRPC-Web body into a schema-less field tree (or JSON, for the `+json` codec). A
per-message compression flag is shown rather than guessed at — a compressed payload
is not inflated, because walking those bytes as protobuf would produce garbage that
could be mistaken for real fields.

The gRPC status — the trailer that carries the real outcome of a call, independent of
the HTTP status, since a failed gRPC call is usually HTTP 200 — is resolved from
whichever place it was actually captured: the gRPC-Web trailer frame embedded in the
body, or a `grpc-status` response header on an HTTP/2 "Trailers-Only" response (a call
that failed before any message was sent). **Real gRPC trailers over plain HTTP/2 are
not captured.** Those arrive as separate HTTP/2 trailer headers after the response
body, and this capture pipeline does not currently retain trailer headers, so a plain
`application/grpc` call that completes normally shows its message frames with no gRPC
status — the HTTP status shown elsewhere is not the gRPC outcome in that case. Only
gRPC-Web and the Trailers-Only failure path resolve a real status today.

## Timing

A per-request waterfall built from `URLSession` task metrics, so DNS, TLS, connect,
time to first byte and download are measured rather than guessed.

## Diagnosis

A one-line, deterministic explanation for common outcomes, read directly off fields
already captured on the request — never a model call, never a guess. Every rule cites
the exact evidence behind it:

- A `401` with an `Authorization` header present reads as "the credential was sent
  and rejected"; a `401` with no header reads as "the credential was never sent" —
  different bugs, different sentences.
- A `304` names the validator that matched: `If-None-Match` or `If-Modified-Since`.
- A `413` reports the request body size that was rejected; a `429` reports the
  `Retry-After` value the server sent.
- A transport failure (no HTTP status reached at all) is phrased around the
  connection phase it died in — DNS, connect, or TLS handshake — folding in redirect
  hop count when the request also redirected.
- A `Content-Type` declared as JSON whose body does not actually parse as JSON is
  flagged as a warning.

When the evidence does not fully support a specific claim, no diagnosis is shown
rather than a guess.

## LLM streams

A `text/event-stream` response gets its events assembled and its token usage
surfaced. Capture keeps the tail of a stream, because that is where the usage numbers
live.

## Diff

Compare two requests structurally — status, headers added, removed and changed, and a
line-level body diff.

## Export

HAR and session files, using the same field mapping the SDKs already use.
