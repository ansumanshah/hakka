---
name: hakka-setup
description: |
  Installs and wires up Hakka, the local-first network inspector, into the user's current
  project. Detects the framework (Next.js, React Native/Expo, or plain web), installs the
  right packages, writes the minimal integration files, and verifies the result before
  reporting success. No proxy, no CA certificate, no cloud, no accounts. Capture happens
  in-process. Full docs: https://hakka.noodleapps.com.
  Use when the user asks to add Hakka, set up Hakka, install the Hakka network inspector,
  wire up hakka-node / hakka-browser / hakka-react-native, or debug why a Hakka overlay
  or bridge isn't showing traffic.
  Triggers: hakka, hakka-node, hakka-browser, hakka-react-native, hakka init, network
  inspector, instrumentation-client.ts, hakka bridge, hakka overlay.
---

# Hakka setup

Hakka is a local-first network inspector: one engine, native overlays on React Native, the
web, Next.js, Android, and iOS. Capture happens inside the app. No proxy, no CA cert, no
cloud, no accounts. Full docs: https://hakka.noodleapps.com.

This skill installs it into whatever project you're currently in. Do the framework
detection and file writes yourself, don't just print the commands and stop.

## 1. Detect the framework

Check `package.json` and config files in the project root, in this order:

| Signal                                              | Framework           | Go to  |
| --------------------------------------------------- | ------------------- | ------ |
| `next.config.*` exists, or `"next"` in dependencies | Next.js             | Step 2 |
| `"react-native"` or `"expo"` in dependencies        | React Native / Expo | Step 3 |
| Anything else (Vite, CRA, plain HTML/bundler app)   | Plain web           | Step 4 |

If two signals match (e.g. Expo web), prefer the native path (step 3). It's the harder
integration to get right, and the web overlay is a subset of what it wires up.

## 2. Next.js

This is the verified, current integration, checked against `hakka-node`'s README as of this
skill's authoring. Read `node_modules/hakka-node/README.md` if it exists, in case a newer
release changed something.

1. Install:

   ```bash
   npm i -D hakka-node
   npm i hakka-browser
   ```

   `hakka-browser` is **not optional** once you wire the client file below. It's declared as
   an optional peer dependency for server-only backends that never touch the client overlay;
   that exemption doesn't apply here.

2. Create `instrumentation.ts` at the project root (or `src/` if the project uses a `src`
   layout):

   ```ts
   export { register } from 'hakka-node/next'
   ```

3. Create `instrumentation-client.ts` next to it (requires Next 15.3+):

   ```ts
   import 'hakka-node/next/client'
   ```

   This one-liner works as of the current `hakka-node` release. An earlier version shipped a
   packaging bug (`sideEffects: false` scoped too broadly) that silently dropped this import
   under Turbopack. It's fixed. If you're on an old pinned `hakka-node` version and the
   overlay never appears, that bug is the first thing to check.

4. Optional: Server Component / Route Handler / Server Action spans. Only do this if the
   user asks for server-side tracing, not by default:

   ```bash
   npm i @vercel/otel @opentelemetry/api
   ```

   ```ts
   // instrumentation.ts
   import { registerOTel } from '@vercel/otel'
   import { hakkaSpanProcessor } from 'hakka-node'
   import { register as hakkaRegister } from 'hakka-node/next'

   export function register() {
     registerOTel({ serviceName: 'app', spanProcessors: [hakkaSpanProcessor()] })
     return hakkaRegister()
   }
   ```

   `spanProcessors: [hakkaSpanProcessor()]` must be passed at construction time. The
   `@opentelemetry/sdk-trace-base` 2.x generation removed `addSpanProcessor`, so attaching it
   after the fact silently no-ops.

5. `next.config.js`, **webpack builds only.** Turbopack (the Next 16 default) doesn't need
   this; skip it unless the project has explicitly opted back into webpack:

   ```js
   module.exports = {
     serverExternalPackages: ['hakka-node', 'hakka-bridge', 'hakka-core', 'ws'],
   }
   ```

   This keeps `ws` (used by the embedded bridge) out of the main webpack bundle, avoiding a
   silent `bufferUtil.mask is not a function` failure. It does not cover the
   `instrumentation.ts` compile layer; `hakka-node` works around that internally, nothing
   else to do here.

6. Don't touch anything else. `register()` is dev-only by default (it no-ops unless
   `NODE_ENV === 'development'`), so production builds are untouched.

## 3. React Native / Expo

Install `hakka-react-native` and follow its own README for the native setup. Expo config
plugin vs. manual linking differ enough that this skill won't restate them; read
`node_modules/hakka-react-native/README.md` after installing and follow it exactly. Don't
improvise the native steps.

## 4. Plain web (Vite, CRA, or no bundler)

Install `hakka-browser`, then either:

- call `start()` once from the app's entry file, or
- drop the CDN `<script>` tag from its README if there's no bundler at all.

## 5. Verify, required, not optional

A setup that isn't verified is a setup that fails silently. Do all of this before telling
the user it worked:

1. Start the dev server (`npm run dev` or the project's equivalent).
2. Next.js: confirm the embedded bridge hub is listening.
   `curl -s http://localhost:8989` should connect (not "connection refused"), or check with
   `lsof -i :8989`.
3. Web / React Native: load the app and confirm the floating launcher/bubble renders, or
   curl the served page and check the HTML/bundle references `hakka-inspector` or
   `hakka-browser`.
4. State exactly which check passed and how you checked it. If none passed, report the real
   error (a missing dependency, a wrong file path, a build failure), don't guess or claim
   success anyway.

## No-agent alternative

`npx hakka init` does steps 1 through 4 without the prose: same framework detection, same
files created, install command printed at the end. It's safe to run even if this skill
already ran; it only creates files that don't exist yet, never edits or overwrites yours.

## Reference

Full docs, including per-platform pages and troubleshooting: https://hakka.noodleapps.com.
