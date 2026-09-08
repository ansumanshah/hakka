---
title: Comparison
description: Where Hakka fits beside in-page consoles, browser DevTools, traffic proxies, Requestly, and API clients.
---

Hakka combines an instrumented network inspector with an API client. Its SDKs capture
traffic from an app you build across web, Node.js, Next.js, React Native, iOS, and
Android; the bridge can put those records in one desktop timeline. The same rules engine
can mock, redirect, block, throttle, or pause matching traffic inside the instrumented
runtime.

:::caution[Pre-release status]
Hakka is pre-1.0 and has not been published. This page describes the current repository,
not an installed public release. The macOS app builds and is tested, but remains
[in development with no signed release](/desktop/overview/). The other products linked
below are publicly available products, so maturity and distribution are not equivalent.
:::

## Choose by the job

| Need                                                   | Best starting point                                                                                                                                                                      | Why                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Inspect your own app across client and server runtimes | Hakka                                                                                                                                                                                    | SDK capture uses one record contract and can correlate traffic across connected runtimes.                                       |
| Debug a page on a phone without desktop DevTools       | [vConsole](https://github.com/Tencent/vConsole) or [eruda](https://github.com/liriliri/eruda)                                                                                            | Both embed a mobile console in the page and include browser-oriented tools beyond network inspection.                           |
| Diagnose one Chromium page in depth                    | [Chrome DevTools](https://developer.chrome.com/docs/devtools/network/)                                                                                                                   | Its Network panel covers browser loading, initiators, timing, WebSocket messages, throttling, filtering, and HAR import/export. |
| Apply shareable browser or desktop traffic rules       | [Requestly](https://requestly.com/products/http-interceptor/)                                                                                                                            | Its interceptor products center on declarative redirect, header, query, response, delay, and mock rules.                        |
| Inspect traffic from apps you cannot instrument        | [Proxyman](https://docs.proxyman.com/) or [Charles](https://www.charlesproxy.com/documentation/)                                                                                         | A system proxy can observe applications routed through it and provides mature rewrite and breakpoint tools.                     |
| Design, send, organize, and automate API requests      | [Yaak](https://yaak.app/docs), [Bruno](https://docs.usebruno.com/introduction/getting-started), or [Postman](https://learning.postman.com/docs/getting-started/basics/postman-elements/) | These products center on authored requests, environments, collections, scripts, tests, and team workflows.                      |

These categories overlap. Chrome offers local response overrides, Requestly now has a
separate API client, proxies can compose requests, and Hakka's macOS app can author and
run requests. The table identifies each tool's strongest starting point rather than
claiming exclusive capabilities.

## Scope comparison

| Tool family                | Where it runs                                                                               | Primary traffic source                                       | Traffic changes                                                         | Request authoring and automation                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hakka repository**       | SDKs in web, server, and native apps; optional bridge, MCP server, and macOS app            | Calls made through an instrumented Hakka runtime             | In-runtime mocks, redirects, blocks, breakpoints, and throttle profiles | The in-development macOS app has file-backed collections, environments, imports, JavaScript hooks, declarative assertions, captures, and folder runs. |
| **vConsole / eruda**       | Embedded in a mobile web page                                                               | Browser activity visible to page-level instrumentation       | Not their documented focus                                              | Browser console and snippet workflows rather than an API collection runner.                                                                           |
| **Chrome DevTools**        | Attached to a Chromium browser target                                                       | Browser Network-domain activity while DevTools is recording  | Local content/header overrides and network throttling                   | Ad hoc resend and copy workflows; browser debugging is the wider product scope.                                                                       |
| **Requestly**              | Browser extension or desktop interceptor; a separate API client                             | Browser or locally intercepted traffic, depending on product | Declarative HTTP rules processed locally                                | The API client supports saved requests, collections, environments, and pre/post scripts.                                                              |
| **Proxyman / Charles**     | System proxy on a development machine, with device proxy setup where needed                 | Traffic routed through the proxy                             | Map Local/Remote, rewrites or scripts, breakpoints, and throttling      | Useful manual composition tools, but traffic inspection and modification are the core workflow.                                                       |
| **Yaak / Bruno / Postman** | Desktop or web API-client workflows, plus CLI and service integrations depending on product | Requests the developer creates or imports                    | Pre-request logic, mocks, or scripts vary by product                    | Deepest group for collections, environments, auth, scripting, tests, runners, and collaboration.                                                      |

The grouped cells stay deliberately coarse. A checkmark matrix would hide meaningful
differences such as whether a mock changes an app's real in-flight request, serves a local
browser override, or runs as a separate mock server.

## Direct alternatives

### vConsole and eruda

Use these when the main problem is a mobile browser with no convenient desktop debugger.
vConsole documents `XMLHttpRequest`, Fetch, and `sendBeacon` capture alongside console,
elements, storage, command execution, and plugins. Eruda exposes Network, Console,
Elements, Resources, Sources, and Snippets tools. Their browser diagnostic breadth is an
advantage when the problem may be DOM, CSS, storage, or JavaScript rather than traffic.

Hakka now includes a [phone debugger](/web/page-debugger/) with JavaScript command execution,
history, selector inspection, a tap picker, DOM outline, and computed styles. Its web UI
also uses the same capture model as server and native SDKs. Opt-in agent tools inspect
and edit DOM text, attributes, and inline CSS with undo. Source breakpoints and stepping
use an explicitly attached Chromium CDP target; an in-page phone overlay alone cannot
provide the browser engine's debugger.

### Chrome DevTools

Chrome DevTools is the stronger default for desktop Chromium debugging. Its official
[Network reference](https://developer.chrome.com/docs/devtools/network/reference/)
documents detailed filters, timing, WebSocket messages, throttling, sanitized or complete
HAR export, and HAR import. [Local Overrides](https://developer.chrome.com/docs/devtools/overrides/)
can replace response content or headers for fetch and XHR requests across reloads.

Hakka is useful when capture must stay available in an embedded or mobile surface, cross a
client/server boundary, or feed the same records to its desktop app or MCP tools. Hakka's
[`hakka cdp` command](/cdp/overview/) can also use Chrome DevTools Protocol capture as an
input; this is a complementary capture path, not a claim that its UI replaces DevTools.

### Requestly

Requestly is a close alternative for traffic-rule workflows. Its official
[HTTP Interceptor overview](https://requestly.com/products/http-interceptor/) covers
redirects, header and query changes, response replacement, cancellation, delay, and mock
responses. Requestly says rule execution and intercepted-request processing happen
[locally in the extension or desktop app](https://docs.requestly.com/security-privacy/http-rules/).
It also ships a separate [API client](https://docs.requestly.com/api-client/overview) with
collections, environments, and [pre/post-request scripts](https://docs.requestly.com/api-client/scripts).

Hakka's distinction is where rules execute: inside the SDK that captured the app's request,
including connected server and native runtimes. Requestly has the more mature browser-rule
distribution and collaboration product. Teams focused on browser-wide rules should assess
that workflow directly rather than infer equivalence from matching feature names.

## Adjacent alternatives

### Proxyman and Charles

Proxyman and Charles are the better fit when the target cannot be changed to include an
SDK. Their proxy position gives them a wider capture boundary. Proxyman documents
[Map Remote](https://docs.proxyman.com/advanced-features/map-remote), JavaScript
[request/response scripting](https://docs.proxyman.com/scripting/script), and
[WebSocket inspection](https://docs.proxyman.com/advanced-features/websocket). Charles
documents HTTPS interception through a generated, locally trusted CA certificate plus
tools such as [Map Remote](https://www.charlesproxy.com/documentation/tools/map-remote/).

HTTPS decryption adds setup and trust considerations. Charles explicitly notes that an app
may still fail when it uses
[certificate pinning](https://www.charlesproxy.com/documentation/faqs/#ssl). The exact
workaround depends on the target and proxy; avoid treating pinning as a universal proxy
failure or a universal Hakka advantage. Hakka’s SDK capture avoids CA setup. Its optional [proxy capture](/proxy/overview/)
uses a local mitmproxy sidecar for uninstrumented applications whose traffic is routed
through it; HTTPS requires client trust in that sidecar’s CA.

### Yaak, Bruno, and Postman

Hakka's macOS app does author requests. It supports file-backed collections,
environments, cURL/Postman/OpenAPI/HAR imports, code generation, declarative assertions,
response captures, OAuth 2.0, JavaScript pre-request and post-response hooks, and sequential folder runs. See
[The API client](/desktop/api-client/) for the current repository scope.

Compare the established API clients by the workflows your team needs:

- [Yaak](https://yaak.app/docs) documents HTTP, GraphQL, gRPC, WebSocket, and SSE requests,
  broad authentication, scripting, Git sync, imports, plugins, CLI use, and an MCP server.
- [Bruno](https://docs.usebruno.com/send-requests/overview) supports REST, GraphQL, SOAP,
  gRPC, and WebSocket requests. Its plain-text, Git-friendly collections and
  [app/CLI collection runners](https://docs.usebruno.com/get-started/bruno-basics/run-a-collection)
  are central to the product.
- [Postman](https://learning.postman.com/docs/tests-and-scripts/tests-and-scripts/) combines
  collections, environments, scripting, tests, mock servers, runners, monitoring, team
  workspaces, APIs, CLI integrations, and a VS Code extension.

Hakka's useful connection is capture-to-authoring: a request observed from an app can
become an editable, committed request or a mock without leaving the inspector. Its current
desktop supports JavaScript hooks as well as declarative assertions; teams
that need schema design, cloud collaboration, scheduled monitoring, or
large test suites should evaluate a dedicated API client.

## Features added from these workflows

These are concrete Hakka capabilities, not claims of complete product parity.

| Reference       | Hakka capability                                                                     | Agent entry point                                                 |
| --------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| vConsole        | Explicit JavaScript runner with async results, errors, and history on a phone        | Page-local JavaScript; no automatic remote evaluation             |
| eruda           | DOM outline, tap picker, selector attributes and computed styles                     | `getPageInfo()` and `inspectPage(selector)`                       |
| Chrome DevTools | Persistent declarative response/header overrides that survive rule export and reload | `createRuleBundle` / `parseRuleBundle` in `hakka-core`            |
| Requestly       | Portable versioned rule bundles with validation and stable IDs                       | MCP `apply_rule_bundle`, including validation-only `dryRun`       |
| Proxyman        | HTTP/HTTPS inspection of apps routed through a local proxy                           | `hakka proxy --json`, captures visible through MCP                |
| Charles         | Map Local and Map Remote rules for proxied traffic                                   | `hakka proxy --map-config mappings.json`                          |
| Bruno           | Execute the desktop’s Git-friendly request files without opening the app             | `hakka run ./collection --json`                                   |
| Postman         | Data-driven runs, response captures, assertions, repeat/delay, JSON/JUnit reports    | `hakka run --data rows.csv --repeat 3 --junit-report results.xml` |
| Yaak            | Authored API collection execution through an agent tool                              | MCP `run_collection`                                              |

The native inspector offers right, bottom, and hidden detail layouts, with native splitters,
menu commands, and keyboard shortcuts. The UI and automation use the same captured records,
authored request files, and declarative rules. See [collection runs](/testing/collection-runner/),
[proxy capture](/proxy/overview/), and [MCP](/mcp/overview/).

## Current trade-offs

- **Capture setup depends on the target.** SDK capture remains the simplest in-process path.
  The optional proxy needs mitmproxy, explicit routing, and client CA trust for HTTPS.
  Certificate-pinned apps and traffic that bypasses the proxy remain outside that path.
- **Release distribution is still pending.** These are repository capabilities; publishing
  the coordinated package set and producing a signed macOS release remain release tasks.
- **Phone diagnostics are useful but bounded.** DOM/inline CSS edits have undo. Engine-level
  source debugging needs an explicit Chromium CDP connection; a full browser performance
  profiler and Safari source-debugging integration are still absent.
- **Portable runs have an explicit supported subset.** HTTP/HTTPS, GraphQL, multipart/files,
  OAuth token grants, finite WebSocket/SSE sessions, and raw unary gRPC use assertions and
  captures. Local CLI hooks are permitted; MCP and server monitors reject executable hooks.
  Interactive OAuth authorization and gRPC streaming/reflection remain separate work.
- **Collaboration is self-hosted.** The team service adds revisioned collection synchronization,
  role-scoped tokens, secret-backed monitors, and run history. It does not provide managed
  hosting, an account dashboard, or an operated cloud service.

## Method

Checked **2026-09-06**. Hakka statements were checked against this repository and its
linked docs. Competitor statements use the official product documentation linked beside
each claim. The comparison uses stable product boundaries and documented workflows rather
than performance claims or exhaustive absence marks, both of which age quickly. Recheck
the linked sources before making a purchase or migration decision.
