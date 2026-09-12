# Hakka launch video

An editable, silent, 30-second HyperFrames composition. Project source is MIT under the repository license. It uses HyperFrames `0.8.35` (Apache-2.0) and GSAP `3.13.0`; see their package licenses before redistributing dependencies.

## Asset provenance

`assets/inspector.png` is a local, live-rendered Hakka browser-demo panel capture from [`examples/browser-demo/index.html`](../../examples/browser-demo/index.html), with the seeded `/search?q=hakka` 500 response selected. It is demo traffic, as the scene states. This project does not fabricate product UI or load remote media. GSAP loads from the pinned local dependency in `node_modules/`.

Each external scene declares the same local system font because HyperFrames resolves and validates those templates independently; the shared layout, palette, and typography remain in `assets/launch.css`.

## Commands

```sh
npm ci
npm run preview
npm run lint
npm run check
npm run render
```

The scripts use documented CLI forms: `preview` starts hot reload, `lint` checks HTML, `check` runs the browser gate at selected timestamps, and `render` writes `renders/hakka-launch.mp4`. Run `npm run render` only after `assets/inspector.png` exists and after coordinating CPU use with other local work.

To use an installed Chrome without downloading a renderer browser on macOS:

```sh
HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run render
```

The output is H.264, 1280×720 at 30 fps, with no audio track.

Generated output belongs in ignored `renders/`, `checks/`, `snapshots/`, and `tmp/`. No cloud services, generated APIs, paid calls, remote media, wall-clock state, or random values are used.
