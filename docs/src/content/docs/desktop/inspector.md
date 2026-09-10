---
title: The inspector
description: Live traffic, filtering, body viewers, timing, WebSocket and gRPC frame inspection, LLM streams, diagnosis, diff, and export.
---

## Workspace navigation

Use **Requests** to author saved API calls, **Traffic** to inspect observed exchanges,
**Rules** to configure traffic behavior, **Runs** to review execution results,
**Proxy** to configure capture, and **Changes** to review the project in Git.
Git is optional; a collection can live in an ordinary local folder.

Requests and captured traffic use the same response inspector. Save a captured
request into the collection to edit it and add assertions, then run it and review
its file changes. Request definitions use readable `.hakka` JSON files;
`.hakka-session` exports contain captured observations.

Requests open in document tabs. Control-Tab and Control-Shift-Tab cycle through them.
Closing a tab keeps its unsaved draft available when reopened. A send that completes
in the background keeps its result with the request that started it. Saving remains
explicit; quitting or opening another project warns before discarding unsaved edits.

The toolbar's environment and connections control selects the environment and shows
bridge/proxy status. Traffic focus and noise controls live beside traffic search.
New installations use the traffic table; a saved list preference remains unchanged.

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

## Saved investigations and focused traffic

Save the current query and selected request as a traffic view with the **+** button
above the traffic list (`⌥⌘T`). Switching views restores that selection and query;
rename or close a view from its menu. Views share the current capture buffer and do
not retain separate copies of request bodies or create isolated projects.

The sidebar's **Focus & Noise** controls save domain, path-prefix, and method filters.
Domains match the named host and its subdomains. Muted hosts remain captured but are
hidden from the list, and noise controls continue to apply when switching Focus Sets.
Use **Clear Focus** to return to the broader traffic list.

In table mode, open **Traffic options → Customize Columns** to add a request or response
header column. Header lookup is case-insensitive; the same name can appear once for each
side. Column choices persist, while values come from the captured, redacted records.

## Body search and local decoding

The JSON tree supports **All**, **Key**, **Value**, and **Path** searches. Results retain
their ancestor branches so a matching value remains understandable. Search is bounded
to 10,000 nodes and 500 matches; a `+` indicates that the result is incomplete.

**Decode JWT…** opens a local paste-and-decode tool. A complete token body can prefill
the input. The tool displays the JSON header and payload under size limits and does
not contact an issuer or verify the signature. Decoding a token does not authenticate it.

**Explain** opens a local report built from captured status, timing, size, and redirect
metadata. It separates observed facts and deterministic findings from suggested next
checks. Copying the report omits request/response bodies, header values, URL query
values, and credentials in URL authority components. Review endpoint paths before
sharing them: paths can still identify resources. No model or cloud service is invoked.

Overview also recognizes JSON-RPC 2.0 calls and responses, including notifications,
request IDs, result presence, and error codes. It summarizes batches of up to 32
messages and bodies up to 64 KiB. Parameters, result payloads, and error data remain
in the normal body viewer; this summary performs no RPC calls or transaction actions.

Use Command-1 through Command-8 for request editor sections and Option-Command-1
through Option-Command-9 for inspector sections. Sent requests open their Response
section immediately. Settings → Appearance selects System, Light, or Dark for Hakka
without changing the Mac’s appearance.
