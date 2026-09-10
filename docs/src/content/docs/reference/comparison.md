---
title: Choose a workflow
description: Choose between Hakka SDK capture, proxy capture, CDP capture, and authored requests.
---

Hakka combines captured traffic and authored requests in one local workflow. The right
starting point depends on which process you control and whether the traffic must remain
inside the application boundary.

:::caution[Pre-release status]
Hakka is pre-1.0 and has not been published. This page describes the current repository,
not an installed public release. The macOS app builds and is tested, but remains
[in development with no signed release](/desktop/overview/).
:::

## Choose by the target

| Target or task                                                  | Start with                                                          | Capture boundary                                         | Setup                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| An app where you can add a Hakka SDK                            | In-process SDK capture                                              | Requests observed by that SDK                            | Add the platform package and start capture               |
| A command, simulator, device, or app that can use an HTTP proxy | [`hakka proxy`](/proxy/overview/)                                   | Traffic explicitly routed through the local sidecar      | Configure the target proxy; HTTPS also requires CA trust |
| A Chromium debugging target                                     | [`hakka cdp`](/cdp/overview/)                                       | Network-domain events from the attached target           | Connect to its debugging port                            |
| A request you want to design and repeat                         | [The macOS API client](/desktop/api-client/)                        | Requests authored or imported into a `.hakka` collection | Open a collection and create or import a request         |
| Captures from several Hakka runtimes                            | [Desktop bridge](/bridge/overview/)                                 | Records streamed over Hakka's bridge protocol            | Connect each runtime to the same local bridge            |
| Automated inspection and replay                                 | [MCP](/mcp/overview/) or [`hakka run`](/testing/collection-runner/) | Live bridge records or saved request files               | Start the local server or run a collection               |

## Capture paths

### In-process SDK capture

Use an SDK when you own the target application. Capture, redaction, rules, and bounded
storage run with the application, and HTTPS inspection does not require a locally trusted
CA certificate. Each platform documents which network clients its interceptor can observe.

This path supports Hakka's direct capture-to-action loop: inspect a request, save it as an
authored request or mock, then replay or apply the rule through the connected runtime.

### Proxy capture

Use proxy capture when you cannot add an SDK but can route the target through a local HTTP
proxy. It emits the same `NetworkRequest` records as SDK capture. It does not bypass
certificate pinning, change global proxy settings, or install trust automatically. The
sidecar listens on loopback unless LAN access is explicitly enabled.

### CDP capture

Use CDP when a Chromium target already exposes a debugging port. Hakka maps Network-domain
events into its record contract and forwards them through the bridge. This is a capture
input; source debugging and browser-engine profiling remain in the attached browser tools.

### Authored requests

Use the macOS request workspace for repeatable API work. Collections are file-backed and
support environments, authentication, scripts, assertions, response captures, imports,
sequential folder runs, and finite WebSocket or SSE sessions. A captured request can be
promoted into the same format.

## Current boundaries

- SDK visibility depends on the platform interceptor and network client.
- Proxy HTTPS capture requires explicit client trust and does not defeat pinning.
- CDP requires a reachable Chromium debugging target.
- Interactive OAuth authorization and gRPC streaming/reflection remain separate work.
- Managed cloud hosting and an operated account service are outside the current release.

Hakka's UI and automation surfaces share the same captured records, authored request files,
and declarative rules. This keeps a workflow portable between the inspector, CLI, tests,
and agent tools without translating it into a second internal model.
