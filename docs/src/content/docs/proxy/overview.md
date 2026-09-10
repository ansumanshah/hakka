---
title: Proxy Capture
description: Capture HTTP and HTTPS traffic from an app that does not use a Hakka SDK, with a local mitmproxy sidecar.
---

`hakka proxy` captures traffic from a command, simulator, or application that is explicitly configured to use its local HTTP proxy. It is for observing apps Hakka cannot instrument in-process. The proxy emits the same `NetworkRequest` frames as the browser, Node, and CDP capture paths, so a running desktop bridge and MCP server receive the records normally.

The command starts a local `mitmdump` sidecar. Hakka does not change your system proxy, firewall, cloud settings, or certificate store. It listens only on `127.0.0.1` by default; `--allow-lan` is an explicit opt-in for a test device on the LAN.

## Install the sidecar

Install mitmproxy separately, then verify it is available:

```bash
brew install mitmproxy
mitmdump --version
```

Start capture and point only the target command or app at it:

```bash
hakka proxy --port 8080
HTTPS_PROXY=http://127.0.0.1:8080 curl https://example.com
```

For a desktop bridge on a non-default port:

```bash
hakka proxy --bridge-url ws://localhost:8989 --har capture.har --session capture.hakka
```

`--max-capture-body` defaults to 102400 bytes. Headers use Hakka's existing sensitive-header redaction before records reach the bridge or either export. Oversized and binary previews are withheld rather than forwarding a partial body; Hakka retains the known size and marks oversized responses as truncated. The proxy keeps at most 10,000 completed records in memory for an export; stop it with Ctrl-C to write `--har` or `--session` output.

## Agent workflow

Start the existing bridge and MCP server, then use a bounded noninteractive proxy run. MCP reads the same bridge-backed Hakka records; it does not need a second proxy protocol.

```bash
hakka mcp --serve
hakka proxy --port 8080 --duration-ms 30000 --session /tmp/task.hakka --json
HTTPS_PROXY=http://127.0.0.1:8080 your-test-command
```

`--json` writes machine-readable `started`, `diagnostic`, `stopped`, `error`, and `cert-info` status lines. `started` includes `{ certificates: { configDir, publicCaPath, publicCaExists, privateKeyExposed: false } }` only after the sidecar is ready. It deliberately does not print captured request bodies or private keys; use the existing MCP request tools or the bounded session/HAR output after capture instead.

Use a task-local mitmproxy configuration directory when a desktop app or CI job needs stable setup information:

```bash
hakka proxy --json --config-dir "$HOME/Library/Application Support/Hakka/proxy" --cert-info
```

The returned `publicCaPath` is the generated public CA certificate path when present. Hakka never reads or reports mitmproxy private-key paths. Mapping changes are startup options; stop and explicitly restart the session after editing `--map-config`.

## HTTPS trust is explicit

HTTP capture works immediately. HTTPS interception requires the target client to trust mitmproxy's generated local CA. Start the proxy, configure the target to use it, then visit `http://mitm.it` **through that proxy** and install trust only in a task-specific browser profile, simulator, or test environment.

Hakka never installs a system CA or modifies global proxy settings. Certificate pinning and platforms that prohibit user-installed trust will fail as designed; this tool does not bypass them. Run `hakka proxy --cert-help` for the concise setup reminder. Do not copy mitmproxy private keys or certificate files into logs, exports, or source control.

## Map Local and Map Remote

Use a JSON file for deliberate, reviewable substitutions. `mapLocal.file` must resolve to an existing regular file relative to the mapping file, so directory and wildcard substitution are rejected. `mapRemote` uses mitmproxy's URL-regex replacement behavior.

```json
{
  "mapLocal": [{ "match": "^https://api.example.test/config$", "file": "./fixtures/config.json" }],
  "mapRemote": [{ "match": "^https://api.example.test/(.*)$", "replace": "http://127.0.0.1:4010/$1" }]
}
```

```bash
hakka proxy --map-config ./proxy-mappings.json
```

Mitmproxy evaluates these substitutions before it sends the request upstream. `$1` style replacement captures in the JSON config are converted to mitmproxy's Python replacement syntax before launch. They are transport mappings, not Hakka mock rules, and they affect only clients configured to use this sidecar.

## Choose a capture path

| Capability                   | Hakka in-process capture                    | `hakka proxy`                                        |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Works without adding an SDK  | No                                          | Yes, when the app uses the proxy                     |
| HTTPS plaintext              | Native/app trust only                       | Requires explicit mitmproxy CA trust                 |
| Certificate pinning          | Observes traffic inside an instrumented app | Does not bypass it                                   |
| Desktop/MCP records          | Direct                                      | Shared Hakka bridge wire format                      |
| Local and remote replacement | Hakka rules in instrumented runtimes        | mitmproxy `map-local` / `map-remote` via JSON config |
| Default network exposure     | None                                        | Loopback only                                        |

## Native macOS workflow

Open **Traffic → Proxy Capture…** (`⇧⌘P`). Start and stop capture, choose the listening
port, enable local-network devices, and edit Map Local/Remote rules in the native window.
Captured requests appear in the existing Live Traffic inspector, where they can be
filtered, exported, or saved as authored requests for replay.

The setup section shows this Mac's active network addresses and the public certificate
location. On a phone, configure the connected Wi-Fi network's manual proxy, then visit
`http://mitm.it` through it for certificate setup. The displayed certificate path only
confirms that the public certificate exists; it does not claim the phone trusts it.

The capture engine runs as a managed mitmproxy process. **Automation → Advanced** accepts
an installed Hakka CLI executable or built `cli.mjs`, plus Node when needed. Hakka shows
startup errors and request counts and shuts down its process when capture stops or the
app quits. Install mitmproxy separately; no terminal command is needed for subsequent
capture sessions once these paths are configured.

For agents controlling the desktop, enable its MCP server in Settings and **Allow agents
to start and stop this proxy** in the Proxy Capture window. Native `proxy_status`,
`proxy_start`, and `proxy_stop` use the same configuration and state as the UI. Control
permission resets when the app quits. The CLI MCP server also exposes proxy sessions and
mapping updates for headless workflows.

System-wide proxy toggles, automatic certificate installation, and certificate-pinning
workarounds are not included. Route only the applications or devices you intend to inspect.

## Native setup and connection tests

The native workspace has **Overview**, **Connections**, **HTTPS**, **Routing**,
**Rules**, and **Automation** sections. Capture status and Start/Stop remain visible
while switching sections. Connections provides separate
Mac, iPhone/iPad, and Android instructions and a **Test This Mac’s Connection** action.
The test sends one bounded request to `example.com` through the configured proxy. When
the public CA is available it uses HTTPS with that CA; otherwise it tests HTTP routing.
It does not establish that another device trusts the CA or uses the proxy.

Runtime recipes for curl, Python `requests`, and Node `undici` use the selected port and
public CA. Each recipe configures only the command being run. Node requires `undici` in
the current project; Python requires `requests`. The recipes preserve TLS verification.

## TLS host scope

Use **Rules → TLS host scope** to pass selected hosts through without decryption, or to
intercept only listed hosts. Changes take effect on the next capture start. The CLI
accepts repeatable flags for the same configuration:

```bash
hakka proxy --tls-bypass-host '*.example.com' --tls-bypass-host pinned.example.test:443
hakka proxy --tls-allow-host api.example.test
```

Choose one mode per session. Entries are literal ASCII hostnames, optionally prefixed
with `*.` or suffixed with a port. A wildcard matches subdomains, not the root domain;
`*.example.com` does not match `example.com`. Raw regular expressions are not accepted.
Scopes are limited to 100 hosts. Bypassed TLS stays encrypted and does not produce a
plaintext HTTP record. This does not disable an app's certificate-pinning checks.

## Header, block, and delay rules

The mapping configuration also supports request/response header edits, local block
responses, and delays:

```json
{
  "headerRules": [
    { "match": "^https://api\\.example\\.test/", "phase": "request", "operation": "remove", "name": "Authorization" },
    {
      "match": "^https://api\\.example\\.test/",
      "phase": "response",
      "operation": "set",
      "name": "Cache-Control",
      "value": "no-store"
    }
  ],
  "blockRules": [{ "match": "/analytics$", "status": 503, "body": "Unavailable for this test" }],
  "delayRules": [{ "match": "/checkout$", "phase": "response", "delayMs": 400 }]
}
```

Edit the same rules in the native **Rules** section. They apply to proxy traffic;
SDK rules remain a separate capture path. Header names are case-insensitive, `set`
replaces existing values, and `remove` deletes the header. Block rules return a local
400–599 response without sending the request upstream. Delay rules add asynchronous
latency, capped at 30 seconds total per phase; they do not simulate bandwidth limits.
Rule changes require capture to stop and restart. Captured records still pass through
Hakka's normal redaction before reaching desktop, MCP, or exports.

Rule URL expressions use a portable subset shared by the native validator and sidecar:
literals, character classes, ordinary/noncapturing groups, quantifiers, anchors, and
alternation. Lookaround, named groups, backreferences, inline flags, Unicode properties,
and engine-specific escapes are rejected. Use literal characters instead of hexadecimal
or Unicode escapes in expressions.

Static request header, block, or request-delay rules disable automatic body streaming
for the managed sidecar session, including a streaming threshold supplied by mitmproxy's
configuration file. This preserves rule enforcement before upstream transmission.

## Live proxy breakpoints

In **Proxy Capture → Rules**, enable **proxy breakpoints for this session** before
starting capture. Create request or response breakpoints in the desktop **Rules**
view. Matching traffic appears in the existing pause inbox, where you can resume
or abort it. The CLI equivalent is `hakka proxy --breakpoints`.

Proxy pauses occur at the header phase, before the body is transferred. Request
pauses support URL, method, and header edits; response pauses support status and
header edits. Resume preserves unchanged fields and the original body. Body edits
are unavailable. Sensitive header values are redacted in the pause snapshot.

The sidecar holds at most 64 concurrent pauses, for at most 60 seconds each.
Timeout, proxy shutdown, or loss of the control connection aborts held traffic.
Live breakpoint control is off by default: enable it only when the clients
connected to your desktop bridge are trusted to modify or abort proxy traffic.
This native permission lasts until Hakka quits. JSON CLI output emits
`breakpoint-ready` when both control connections are ready; the desktop uses this
event to resend its saved breakpoint rules.

## Automatic routing on this Mac

In **Proxy → Connections → This Mac**, enable **Route this Mac through Hakka while capture runs**.
After the listener is ready, Hakka records the existing HTTP and HTTPS proxy settings
and routes enabled network services through the local listener. Stop restores settings
that still belong to that session. Newer changes made in System Settings are preserved.
Recovery information stays on this Mac. Hakka refuses to replace an unresolved recovery
record, and refuses to quit normally if restoration fails.

Services with existing proxy authentication are left unchanged because Hakka cannot
recover their passwords. **Launch an App Through Hakka…** instead starts a selected app
with proxy and certificate environment variables; the app must support those variables.
Neither option installs certificate trust automatically.

## PAC and authenticated upstream proxies

Choose **Direct**, **Upstream**, or **PAC** in **Proxy → Routing**. PAC uses an explicitly
selected file or URL, and supports ordered `DIRECT`, `PROXY`, and `HTTPS` destinations.
Credentials apply only to the exact configured proxy endpoint, never to the origin
server or an unrelated PAC destination.

The CLI accepts a private JSON file with `--routing-config routing.json`:

```json
{
  "version": 1,
  "mode": "pac",
  "pac": { "file": "/absolute/path/routes.pac" }
}
```

For a fixed upstream, use `"mode": "upstream"` and
`"upstream": { "url": "http://proxy.example:8080" }`. An upstream endpoint can include
an `authentication` object with `username` and `password`. Credential-bearing files
must be readable only by their owner (`chmod 600 routing.json`) and kept out of Git.
The desktop creates a private launch file and removes it after startup or failure.

The older `--upstream-proxy http://proxy.example:8080` option remains available for
unauthenticated fixed proxies; it cannot be combined with `--routing-config`.
Fallback is limited to connection failures before delivery becomes uncertain, so a
lost response does not silently replay a POST against another route.

## Proxy scripts

Select a local JavaScript file under **Proxy → Automation** and enable it for the next
capture, or use `hakka proxy --script hooks.js`:

```js
function onRequest(request) {
  request.headers['x-test-client'] = 'hakka'
}

function onResponse(response) {
  response.headers['cache-control'] = 'no-store'
}
```

Hooks can edit supported URL, method, status, header, and UTF-8 body fields. They run
in a local QuickJS sandbox with no host filesystem or network APIs. Each evaluation
has a CPU and memory limit; source and body sizes are bounded. Failure leaves the
exchange unchanged and reports a generic diagnostic. Scripts are local test code,
not a replacement for captured-record redaction.

Scripts require buffered bodies. Request header breakpoints run before the request
body script; response scripts run before response breakpoints. Unchanged repeated
headers, including multiple `Set-Cookie` fields, are preserved.

## Network conditions

Choose a profile under **Proxy → Routing**, or use:

```sh
hakka proxy --network-profile slow-3g
hakka proxy --network-profile offline
hakka proxy --network-profile custom --latency-ms 200 --upload-bps 64000 --download-bps 128000
```

Bandwidth values are **bytes per second**, applied to each client TCP connection by
an opaque relay. HTTP/2 streams within one connection share its allowance. Limits
include wire bytes such as CONNECT and TLS overhead, not only captured body bytes.
Latency is split between request and response phases. Offline returns a local HTTP
503 without forwarding the HTTP request upstream. These are repeatable test conditions,
not an exact model of a mobile radio network. Python 3 is required for rate limiting.
