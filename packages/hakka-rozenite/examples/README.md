# Verifying the panel without a device

A Rozenite plugin has no standalone "npm start" story: `<hakka-request-list>`
only ever runs inside a real React Native app's DevTools, wired up by a real
Metro/Re.Pack config. There is nothing to scaffold here that would run on its
own the way `hakka-browser/examples/vite-app` does.

What this directory holds instead is the reproducible, no-device verification
procedure that was actually run against this package on 2026-08-29 (see the
parent [`README.md`](../README.md)'s "Verification status" section for the
full writeup and reasoning). It proves two things without a physical or
simulated RN device: the compiled panel bundle runs and renders correctly,
and the RN -> panel `request` wire message round-trips through the real
Rozenite transport. It does not prove Metro's plugin auto-discovery or the
device-side CDP transport; those need step "6." in the parent README's
"Manual verification steps for the last remaining gap" instead.

## Reproduce it

From the repo root:

```sh
bun run --cwd packages/hakka-rozenite dev
```

This runs `rozenite dev`, which starts two watchers (`vite build --watch` for
the `react-native/` entry point) plus a `vite dev` server for the panel
itself. The panel's dev server does **not** land on the port in
`vite.config.ts` (`3000`): Rozenite's `VITE_ROZENITE_TARGET=client` build
picks its own port. Watch the terminal output for the real one:

```
VITE v7.3.6  ready in 766 ms
➜  Local:   http://localhost:8888/
```

Open that URL. You're looking at `@rozenite/vite-plugin`'s "Dev Host", the
same page `rozenite dev` always serves, standing in for React Native
DevTools. It loads the actual compiled `dist/devtools/App.html` in an iframe
on the left, with a message log and a manual command dispatcher on the right
(drag the horizontal splitter up if the dispatcher's Payload field is cut
off).

**Confirm the panel itself works:** click "Load sample traffic" inside the
panel (left pane). ~11 rows should appear with correct method colors,
status-code styling, and duration/size formatting; selecting one should open
the detail pane with working tabs. This exercises the compiled
`hakka-browser/react`/`hakka-browser/elements` bundle, not a mock. It's the
real thing, rendered by a real browser.

**Confirm the production wire protocol works:** in the dispatcher on the
right, set Command to `request` and paste the contents of
[`sample-request.json`](./sample-request.json) into Payload, then send it.
A new row should appear in the panel's request list within one message. This
is the exact shape `react-native/bridge.ts`'s `createHakkaRozeniteBridge`
sends in production (`client.send('request', request)`), delivered over the
same `window.postMessage({pluginId, type, payload})` transport
`@rozenite/plugin-bridge` uses on a real device, just driven by hand instead
of by `Hakka.getLogs()`.

## The dev flow bug, and its fix

The message log will also show a `get-snapshot` message pair fire
automatically when the panel loads, and nothing populates from it. That's
`rozenite.config.ts`'s own packaged `dev.flows[0]` ("Request snapshot"),
which is supposed to auto-populate the panel with fake traffic on load and
doesn't. Full root-cause writeup is in the parent README; the short version
is it sends `get-snapshot` in the wrong direction, and even fixing that, it
returns from `run()` before its listener can ever fire.

[`fixed-dev-flow.rozenite.config.ts`](./fixed-dev-flow.rozenite.config.ts) is
the tested fix, verified live to auto-populate a fake request the instant
the panel loads, no manual dispatch needed. It is a reference file only (not
wired into the build); paste its `dev` block over the one in
`../rozenite.config.ts` to apply it.

## What this does not prove

- That Metro's plugin auto-discovery (`@rozenite/metro`'s `withRozenite`)
  actually finds this package in a real app's `dependencies` and mounts its
  panel in a real React Native DevTools sidebar.
- That the device-side CDP transport
  (`global.__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__`) carries the same messages
  correctly from inside a real Hermes/JSC runtime; only the Dev Host's
  `window.postMessage` half of `@rozenite/plugin-bridge`'s transport was
  exercised here.
- Capture volume. One hand-dispatched message is not a load test.
