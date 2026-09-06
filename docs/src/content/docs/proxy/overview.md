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

`--json` writes machine-readable `started`, `diagnostic`, `stopped`, or `error` status lines. It deliberately does not print captured request bodies; use the existing MCP request tools or the bounded session/HAR output after capture instead.

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

Mitmproxy evaluates these substitutions before it sends the request upstream. They are transport mappings, not Hakka mock rules, and they affect only clients configured to use this sidecar.

## Operational comparison

| Capability                   | Hakka in-process capture                    | `hakka proxy`                                        | Proxyman / Charles class of tools |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| Works without adding an SDK  | No                                          | Yes, when the app uses the proxy                     | Yes                               |
| HTTPS plaintext              | Native/app trust only                       | Requires explicit mitmproxy CA trust                 | Requires their proxy CA trust     |
| Certificate pinning          | Observes traffic inside an instrumented app | Does not bypass it                                   | Does not inherently bypass it     |
| Desktop/MCP records          | Direct                                      | Shared Hakka bridge wire format                      | Separate product/session format   |
| Local and remote replacement | Hakka rules in instrumented runtimes        | mitmproxy `map-local` / `map-remote` via JSON config | Product-specific mapping tools    |
| Default network exposure     | None                                        | Loopback only                                        | Varies by product configuration   |

This is intentionally a narrow local sidecar, not a replacement for a full proxy debugging application: it does not provide a native traffic UI, replay workspace, system-wide proxy controls, or certificate-pinning workarounds.
