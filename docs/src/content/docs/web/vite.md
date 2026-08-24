---
title: Build Tool Plugins
description: unplugin-based Vite, webpack, and rspack plugins that inject the Hakka network inspector overlay during dev and leave production builds untouched.
---

`hakka-browser` ships build-tool plugins as subpath exports — `hakka-browser/vite`, `hakka-browser/webpack`, and
`hakka-browser/rspack` — built on [unplugin](https://github.com/unjs/unplugin), so the same plugin logic
targets every bundler from one source. Each plugin injects `start()` from `hakka-browser` into the page
during dev. Production builds are untouched by default.

For an overview of the web SDK see [/web/overview/](/web/overview/).

## Vite

### Install

`hakka-browser` is the only package you need — the Vite plugin is a subpath export, not a separate package.

```bash
npm install hakka-browser
```

Peer requirement: `vite >=5.0.0`.

### Add the plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import hakka from 'hakka-browser/vite'

export default defineConfig({
  plugins: [hakka()],
})
```

That is all the configuration needed for most projects.

### How it works

The plugin uses Vite's `transformIndexHtml` hook (order: `post`) to append a `<script type="module">` tag
to the page body. The script imports `start` from `hakka-browser` and calls it with the options you pass.

When `devOnly` is `true` (the default), the plugin sets `apply: 'serve'`, so it runs only during
`vite serve` and is excluded from `vite build` entirely. No Hakka code reaches the production bundle.

## webpack

### Install

```bash
npm install hakka-browser html-webpack-plugin
```

`html-webpack-plugin` is required — the webpack plugin injects the overlay script into the HTML it
generates.

### Add the plugin

```js
// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin')
const hakka = require('hakka-browser/webpack').default

module.exports = {
  plugins: [new HtmlWebpackPlugin(), hakka()],
}
```

## rspack

### Install

```bash
npm install hakka-browser html-webpack-plugin
```

rspack's plugin also requires `html-webpack-plugin` for the same reason as webpack.

### Add the plugin

```js
// rspack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin')
const hakka = require('hakka-browser/rspack').default

module.exports = {
  plugins: [new HtmlWebpackPlugin(), hakka()],
}
```

## Other bundlers

Bundlers without an HTML pipeline (esbuild, rollup) don't get a plugin — use the one-line manual setup
instead:

```ts
import { start } from 'hakka-browser'

if (import.meta.env.DEV) start()
```

## Options

```ts
hakka({
  devOnly: true, // default — omit from the production build
  start: {
    // forwarded verbatim to hakka-browser start()
    overlay: 'launcher',
    console: true,
    captureBeacons: true,
  },
})
```

| Option    | Type                      | Default | Description                                                                                           |
| --------- | ------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `devOnly` | `boolean`                 | `true`  | Restrict injection to dev mode. Set `false` to also inject into the production build (rarely needed). |
| `start`   | `Record<string, unknown>` | `{}`    | Options forwarded verbatim to `hakka-browser`'s `start()`.                                            |
| `server`  | `boolean`                 | `false` | Vite only — auto-register `hakka-node` server-side capture. See below.                                |
| `nonce`   | `string`                  | —       | CSP nonce for the injected `<script>` tag. See [CSP](#csp) below.                                     |

## `start()` options

These keys are accepted in the `start` bag and passed through to `hakka-browser`:

| Key              | Default      | Description                                                                                                           |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `overlay`        | `'launcher'` | `'launcher'` shows a small button; `true` opens the inspector immediately; `false` hides it (call `show()` manually). |
| `resourceTiming` | `true`       | Enrich captures with the Performance Timeline (DNS, TLS, connect, TTFB).                                              |
| `captureBeacons` | `true`       | Capture `navigator.sendBeacon` calls.                                                                                 |
| `console`        | `true`       | Capture `console.log/warn/error/info/debug` output.                                                                   |
| `logToConsole`   | `false`      | Mirror each captured request to the browser DevTools console.                                                         |
| `maxRequests`    | —            | Maximum requests to keep in the store (forwarded to `hakka-core`).                                                    |
| `maxAge`         | —            | Maximum age in ms before a captured request is evicted.                                                               |
| `ignoreHosts`    | —            | Array of hostnames to ignore.                                                                                         |
| `ignorePatterns` | —            | Array of URL patterns to ignore.                                                                                      |
| `redactHeaders`  | —            | Array of header names to redact from captures.                                                                        |
| `maxBodySize`    | —            | Maximum body size in bytes to capture.                                                                                |

## Server-side capture (Vite only)

```ts
hakka({ start: {}, server: true })
```

`server: true` auto-registers `hakka-node` (an optional peer — install it with
`bun add -D hakka-node` if you use this) so the Vite dev server's own requests
(SSR loaders, API routes) show up in the overlay alongside client traffic, with
no manual `instrumentation.ts`/`register()` call needed. `register()` carries
its own dev-only gate, so this is a no-op outside development regardless.

This option only exists for Vite, and only because of a real asymmetry: Vite's
dev server runs in-process, so the plugin's `configureServer` hook can reach in
and register capture directly. webpack and rspack's dev servers front a
separate bundling process that doesn't own the app's actual server runtime —
there's no server for a `configureServer`-style hook to instrument — so their
plugins silently ignore `server: true` rather than fake support for it.

## CSP

The plugin's only injection mechanism is an inline `<script type="module">` tag. Under a
[Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) `script-src` that doesn't
include `'unsafe-inline'`, the browser drops that tag silently — no error from Hakka, just a CSP violation
in the console the plugin never sees, and the overlay simply never starts.

If your dev/preview environment enforces such a policy, pass the same nonce your CSP header or `<meta>` tag
already issues for that response:

```ts
hakka({ nonce: cspNonceForThisRequest })
```

A nonce only works when it matches the value your CSP emits **for that exact response** — a hardcoded or
stale nonce is rejected the same as none at all. If your setup can't thread a per-request nonce into the
Vite/webpack config at all, skip the plugin and call `start()` manually from your own app code instead (see
[Other bundlers](#other-bundlers)) — that's ordinary bundled app code, not an ad-hoc inline script, so it
isn't subject to `script-src` the way the plugin's auto-injected tag is.

## XHR caveat

The XHR interceptor patches `XMLHttpRequest`. Requests go through as normal — response bodies are
captured where the browser exposes them. There is no proxy; traffic never leaves the browser.

## Production safety

With the default `devOnly: true`, the Vite plugin registers itself with `apply: 'serve'`, so
`transformIndexHtml` never runs during `vite build` and the production bundle contains no Hakka code
at all. The webpack and rspack plugins apply the same dev-only gate. Only set `devOnly: false` if you
intentionally want the inspector in a staging or preview build.

Hakka is local-first: no cloud, no accounts. Captured traffic stays in the browser tab.
