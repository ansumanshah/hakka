# Hakka launch film

30 seconds, 1920×1080, 30 fps, H.264. Silent by design; all meaning is visible.

The film follows a failed request through filtering, its response, cURL export,
and Agent context. Typography uses word masks, short weight transitions, and
settled reading holds. The final URL is fully visible from 27–30 seconds.

## Editable source

- `index.html`: the complete, deterministic GSAP timeline and editorial copy.
- `assets/launch.css`: layout, typography, and camera framing.
- `assets/workflow.mp4`: real interactions recorded from Hakka's current embedded inspector.
- `assets/failed-request.png`, `assets/overview.png`: actual inspector captures.
- `assets/clipboard.json`: actual cURL and Agent clipboard output, using demo data only.
- `capture.cjs`: repeatable capture with assertions for filtering, response, and both clipboard outputs.

The orange pointer indicates actual mouse input. Camera crops, headings, and
clipboard excerpts are editorial overlays. No inspector features or agent replies
are fabricated. Seeded traffic is explicitly labeled in the film.

## Preview and export

From this directory:

```sh
npm ci
npm run preview
npm run lint
npm run check
HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run render
```

The renderer writes `renders/hakka-launch.mp4`; the poster is `renders/hakka-poster.png`.
Reviewed delivery copies are tracked in `delivery/` so the finished film and poster
are available alongside the editable source on GitHub.
HyperFrames 0.8.60 and GSAP 3.15.0 remain pinned. Rendering loads local assets only.

## Refresh product footage

Use the current generated docs embed bundle. From the repository root, serve it:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/public
```

In another terminal, from the repository root:

```sh
bun run media:capture
```

Requires the repository's installed Playwright, Google Chrome and FFmpeg.
The capture records device-resolution frames from the 1280×540 viewport at
2560×1080 and preserves their real timing in a 20-second source clip. Recheck framing after any inspector UI change.
The script only interacts with local seeded demo traffic.

After rendering, extract the poster:

```sh
ffmpeg -y -ss 28 -i renders/hakka-launch.mp4 -frames:v 1 renders/hakka-poster.png
```

## Fonts and licenses

Geist and Geist Mono variable WOFF2 fonts are bundled locally from
[vercel/geist-font](https://github.com/vercel/geist-font), retrieved 2026-09-22.
Their SIL Open Font License is included at `assets/fonts/OFL.txt`.
Original composition and demo captures use the repository's MIT license.
No third-party music, stock footage, or remote rendering service is used.

Generated renders, raw recordings, checks, and snapshots remain ignored.
