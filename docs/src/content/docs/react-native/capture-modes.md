---
title: Capture Modes
description: Choose native, JS, or auto capture in React Native apps.
---

Hakka exposes four React Native capture modes: `auto`, `native`, `js`, and `disabled`.

## Auto

```ts
Hakka.start({ mode: 'auto' })
```

`auto` prefers native capture when the native module is present and falls back to
JS interception when it is not.

Use this as the default for most apps.

## Native

```ts
Hakka.start({ mode: 'native' })
```

`native` fails fast when the native module is missing. Use it in development
builds or native-first apps where missing native capture should be treated as a
configuration problem.

Native capture observes traffic made through native platform networking APIs.

## JS

```ts
Hakka.start({ mode: 'js' })
```

`js` intercepts fetch, XHR, and WebSocket traffic at the JavaScript layer. Use it
when you intentionally want JS interception or when testing fallback behavior.

JS mode cannot observe traffic made directly by native SDKs.

## Disabled

```ts
Hakka.start({ mode: 'disabled' })
```

`disabled` installs nothing and captures nothing. Use it to keep a single call
site while gating capture behind your own runtime flag.

## WebSocket Frame Capture

WebSocket frame capture requires JS-layer interception. The JS package monkey-patches the global `WebSocket` API and captures individual message events (`messages: WsMessage[]` on `NetworkRequest`). The native OkHttp and `URLProtocol` interceptors only see the HTTP Upgrade handshake — not frames after the protocol switch.

| Mode     | WebSocket frames captured?                                                                        |
| -------- | ------------------------------------------------------------------------------------------------- |
| `js`     | Yes                                                                                               |
| `auto`   | Yes — `auto` uses JS-layer capture for WebSocket traffic even when native mode is active for HTTP |
| `native` | No — upgrade handshake only                                                                       |

:::tip
If your app uses WebSockets and you need frame-level visibility, `mode: 'auto'` is sufficient — you do not need to switch the whole app to `mode: 'js'`.
:::

The native layer can additionally capture WebSocket **metadata** (message count and
close code, not frame payloads) opt-in: iOS via `captureNativeWebSocket: true` on a
`URLSessionWebSocketTask` monitor, and Android via the OkHttp WebSocket listener
wrapper. Frame payloads still require JS-layer capture.

## Mock Rules

JS mock rules are mirrored into native capture where supported, so mock behavior
continues to work when `auto` selects the native path.
