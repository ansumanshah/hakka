# Hakka native proxy prototype

An experimental external HTTP proxy implemented with SwiftNIO. It requires no SDK inside the inspected application. The existing Hakka desktop capture remains the supported integration while this engine is evaluated.

## Build and run

Requires macOS 14+, Swift 6.1+, and `/usr/bin/openssl` for task-local certificate creation. Dependency versions are pinned in `Package.swift` and `Package.resolved`.

```sh
swift build --package-path native-proxy --configuration release --jobs 4
native-proxy/.build/release/hakka-native-proxy --host 127.0.0.1 --port 0
```

The default supports HTTP GET/POST and opaque CONNECT tunnelling. For HTTPS interception, explicitly supply a new private CA directory:

```sh
native-proxy/.build/release/hakka-native-proxy --ca-dir /absolute/private/capture-ca
```

The directory must be owned by the current user with mode `700`. The engine creates a task-local CA; it never installs it in macOS, changes system routing, or modifies a device. The caller configures the selected client's proxy and trusts the public CA through an explicit setup flow. The ready event includes the actual port, public certificate path and SHA-256 fingerprint. Private keys never appear in events.

`--upstream-ca /absolute/fixture-ca.pem` is an explicit fixture/server trust override. Upstream certificate and hostname verification stay enabled. No insecure TLS flag exists.

## Modules and integration

| Responsibility                                | Owner                                      |
| --------------------------------------------- | ------------------------------------------ |
| Admission, listener and shutdown              | `NativeProxyServer`                        |
| HTTP parsing, forwarding and bounded previews | Request/response handlers                  |
| CONNECT upgrade and backpressure              | Connect upgrade and tunnel relay           |
| CA ownership, leaf cache and verified TLS     | `LocalCertificateAuthority`                |
| Redaction before observers/export             | `CaptureRecorder` and `FlowRedactor`       |
| Bounded JSONL and signal lifecycle            | `HakkaNativeProxy` executable              |
| Private end-to-end evidence and comparison    | `scripts/` and [harness guide](HARNESS.md) |

The executable emits JSONL `ready`, `flow`, then `stopped` events. The flow schema is compatible with the existing Hakka proxy mapper. An adapter must identify the engine as `swift-nio`; the current mapper defaults its library identity to `mitmproxy`. Compatibility alone does not establish desktop/bridge ingestion. Noodle consumes the Hakka-facing contract rather than owning another interceptor or store.

Networking uses two event-loop threads. Incoming clients, pending request bytes, decoder headers, retained body previews, certificate work/cache and the output queue are bounded. Full bodies are forwarded even when their capture preview is omitted. Slow output can drop capture records; the final event reports capture drops and output failure. A failed shutdown must not be reported as stopped.

## Current limits

- HTTP/1.1 GET/POST; one request per connection. Other methods, pipelining and WebSocket upgrades are rejected.
- CONNECT either forwards opaque bytes or terminates TLS and forwards HTTP/1.1 to the CONNECT authority. HTTP/2, HTTP/3, WebSocket interception and connection pooling are pending.
- Loopback listener only. Physical-device LAN capture remains with the existing engine.
- Plain text and complete JSON previews are supported. Truncated, malformed/deep JSON, form, binary and unknown body previews are withheld. Sensitive headers, known query keys and JSON fields are redacted before publication.
- Certificate generation uses native OpenSSL subprocesses, a private CA directory with exclusive ownership, a bounded in-memory leaf cache and manual renewal. It is not a single-dependency binary.
- Proxy readiness does not prove client routing, device trust, bridge delivery, application identity or complete traffic coverage. Pinning and proxy bypass remain limits.
- No desktop engine selector, automatic Simulator setup, Codex panel integration, signing or packaged release is established by building this package.

The benchmark uses matched fresh-connection traffic. It does not represent keep-alive workloads or justify production engine replacement until protocol coverage and correctness match.
