# Docs screenshots

Inspector screenshots used across the docs site. Reference them from a page with a
relative markdown image, e.g. from `src/content/docs/web/overview.mdx`:

```md
![alt text](../../../assets/screenshots/hakka-browser-network.png)
```

Astro optimizes these automatically (hashed + resized into `dist/_astro/`).

## Captured (web overlay)

This is a real screenshot of the `hakka-browser` inspector, captured from the self-contained
demo at `docs/public/embed/index.html` (it loads the built `hakka-browser.global.js` and seeds
fake traffic via `Hakka.ingest`). Prefer this over `packages/hakka-browser/demo/index.html`: the embed page
runs `overlay:false` + `Hakka.show()` so the panel fills the frame immediately at full height —
no floating pill to click, no browser chrome to crop out afterward.

| File                        | Shows                                                                                                                                                             | Used by                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `hakka-browser-network.png` | Request list (plain colored method text, status colors, timing, size, one 5xx error row) split-view next to a request detail pane on the Response tab (JSON body) | root `README.md` hero image |

Headers and the timing waterfall live on their own detail tabs (`Headers`, `Timing`) and can't
appear in the same static frame as the JSON body — Response was chosen as the single richest tab
to capture. Swap `respTab` for `Headers`/`Timing` in the script below to capture those instead.

Three other captures previously lived here (`hakka-browser-detail.png`,
`hakka-browser-mock.png`, `hakka-browser-breakpoints.png`). They showed a
nine-top-level-tab bar (Network/Stats/**Mock**/**Breaks**/**Throttle**/Logs/Storage/**Info**/Settings)
from before Mock+Breakpoints+Throttle merged into one **Rules** tab and Info
merged into Settings, and were referenced by no doc page — deleted rather than
kept stale. Re-capture fresh screenshots against the current UI if
`web/overview`, `features/mocking`, or `features/breakpoints` need one:

```bash
just sync-embed                                        # rebuilds packages/hakka-browser and refreshes docs/public/embed/*
python3 -m http.server 8799 --directory docs/public     # do NOT open as a file:// URL — the worker won't init
```

Then drive it with Playwright (already a devDependency of `packages/hakka-browser`, used by its `e2e/`
suite) — navigate to `http://localhost:8799/embed/index.html?tab=network`, wait for
`hakka-inspector`'s shadow root to contain `.hakka-panel`, click a `.hakka-row` to populate the
detail pane, click a `.hakka-tab` inside `.hakka-network-detail-pane` to pick Overview / Headers /
Request / Response / Timing, then screenshot the page — the panel already fills the viewport, so
no cropping is needed. Use a `deviceScaleFactor: 2` page for retina output, and trim the viewport
height to the actual content height (no fixed-height overlay, so a full 900px viewport leaves a
dead black band below a short request list) rather than a literal 1440×900 capture.

## Captured (Next.js full-stack)

| File                     | Shows                                                                                                                                            | Used by           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `hakka-next-runtime.png` | One client row (`/api/products`, untagged) plus two `SERVER`-tagged rows — the Server Component's fetch and the route handler's downstream fetch | `nextjs/overview` |

Scripted, not hand-taken — regenerate it with:

```bash
cd examples/next-fullstack && rm -rf .next && bun run dev      # terminal 1
node packages/hakka-browser/scripts/capture-next-runtime.mjs   # terminal 2
```

The script drives the real example app (no seeded `Hakka.ingest` data — a fake
capture would prove nothing about the integration that page documents), asserts
that a `server`-tagged row is actually present before writing, and clips to the
panel. Its header explains why the cold `.next` and the fresh dev server matter.

## Still needed (native — capture on device/simulator)

Each page below still has a `{/* TODO(screenshot) */}` comment. Capture the image,
drop it here with the suggested filename, and replace the comment with a markdown
image.

| Suggested file                | Capture                                                                           | Page with the TODO                          |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `hakka-rn-bubble.png`         | RN inspector overlay (bubble open, request list) on iOS/Android simulator         | `react-native/package`, `react-native/expo` |
| `hakka-production-safety.png` | (optional) overlay absent in a release build, or the no-op artifact in the bundle | `guides/production-safety`                  |

> `mcp/overview` no longer needs a device screenshot: it uses an illustrated transcript at
> `docs/public/mcp-agent-loop.svg`, rendered from real `diagnose` → `create_mock` → `generate_repro`
> tool output.

## GIFs (high-leverage, optional)

Short loops sell the interactive features. Suggested captures (web demo works for all):

- `hakka-breakpoint-flow.gif` — add a breakpoint, trigger a request, edit it, Resume → `features/breakpoints`
- `hakka-mock-flow.gif` — add a mock rule, see the matched request served from the mock → `features/mocking`
- `hakka-open-overlay.gif` — click the pill, the inspector opens, scrub a request → homepage

## Specs

- **Viewport:** 1440px wide; trim the height to the actual content (see above) rather than a
  fixed 900px.
- **Theme:** the overlay ships dark; keep it dark for consistency.
- **Format:** PNG for stills, GIF (or MP4 → GIF) for flows. Keep stills well under 1 MB;
  compress with `oxipng`/`pngquant` if a capture lands large.
