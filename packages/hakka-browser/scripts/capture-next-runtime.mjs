#!/usr/bin/env node
/**
 * Captures `docs/src/assets/screenshots/hakka-next-runtime.png` — the overlay
 * showing a server-side fetch and a client-side fetch side by side, each with
 * its runtime tag. This is the one screenshot the docs still need that does not
 * require a device, so it is scripted rather than taken by hand.
 *
 * Unlike the web hero shot (which seeds fake traffic through `Hakka.ingest` on
 * the embed page), this drives the REAL `examples/next-fullstack` app: the
 * server fetch is a genuine Server Component `fetch`, captured by
 * `hakka-node/next` and relayed to the browser through the embedded bridge hub;
 * the client fetch is a genuine browser `fetch` to the route handler. A seeded
 * capture would prove nothing about the integration this page documents.
 *
 * Usage:
 *   cd examples/next-fullstack && rm -rf .next && bun run dev      # terminal 1
 *   node packages/hakka-browser/scripts/capture-next-runtime.mjs   # terminal 2
 *
 * Start from a cold `.next` and a freshly started dev server, or the figure
 * comes out wrong in two ways. The Server Component's fetch uses
 * `next: { revalidate: 60 }`, so a warm cache serves it without making a
 * request and its row never appears. And the bridge hub is embedded in the dev
 * server, so it replays everything it has buffered to each new client — a
 * long-running server produces a list full of repeats from earlier sessions.
 *
 * Env:
 *   HAKKA_CAPTURE_URL   dev server origin (default http://localhost:3000)
 *   HAKKA_CAPTURE_OUT   output PNG path (default the docs asset above)
 *
 * Exits non-zero if the overlay never opens or if both runtimes are not
 * represented — a screenshot that silently shows only client rows would defeat
 * the point of the figure.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

const URL = process.env.HAKKA_CAPTURE_URL ?? 'http://localhost:3000'
const OUT = process.env.HAKKA_CAPTURE_OUT ?? path.join(repoRoot, 'docs/src/assets/screenshots/hakka-next-runtime.png')

/** The launcher is a bare <button> with no class — match the aria-label instead. */
const LAUNCHER = 'button[aria-label="Open Hakka inspector"]'

function fail(msg) {
  process.stderr.write(`\nFAIL: ${msg}\n`)
  process.exit(1)
}

const browser = await chromium.launch()
// deviceScaleFactor 2 for retina output, per docs/src/assets/screenshots/README.md.
// The height is trimmed to the content below — a full 900px leaves a dead black
// band under a short request list, which that README calls out explicitly.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

try {
  const res = await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => null)
  if (!res) fail(`could not reach ${URL} — start it with \`cd examples/next-fullstack && bun run dev\``)

  // Next's dev-tools badge floats bottom-left and would sit in the frame.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })

  // The Server Component's fetch already ran during render. Trigger the client
  // half so the list holds both runtimes.
  await page.getByRole('button', { name: /Fetch products/i }).click()
  await page.waitForFunction(() => document.querySelectorAll('li').length > 0, { timeout: 15_000 })

  await page.waitForSelector(LAUNCHER, { timeout: 15_000 })
  await page.click(LAUNCHER)

  // `show()` lazy-loads the Solid chunk, so the element appears before its content.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('hakka-inspector')
      return !!el?.shadowRoot?.querySelector('.hakka-panel')
    },
    { timeout: 20_000 },
  )
  await page.waitForFunction(
    () => (document.querySelector('hakka-inspector')?.shadowRoot?.querySelectorAll('.hakka-row').length ?? 0) > 0,
    { timeout: 20_000 },
  )
  // Deliberately NOT clearing the list first. Next caches the route handler, so
  // a repeat call to /api/products makes no upstream request — the `server` row
  // this figure exists to show would never come back, leaving a single client
  // row. The list as captured is real dev traffic (Server Component re-renders
  // do repeat the same fetch), which is more honest than a staged pair.
  //
  // Let the bridge deliver the server-side rows and the list settle.
  await page.waitForTimeout(3000)

  const runtimes = await page.evaluate(() => {
    const root = document.querySelector('hakka-inspector')?.shadowRoot
    if (!root) return []
    return [...root.querySelectorAll('.hakka-row')].map((r) => r.textContent ?? '')
  })
  const hasServer = runtimes.some((t) => /server/i.test(t))
  process.stdout.write(`rows: ${runtimes.length}, server-tagged: ${hasServer}\n`)
  if (runtimes.length === 0) fail('the request list is empty — nothing to show')
  if (!hasServer) {
    fail(
      'no server-tagged row — the figure is meant to show both runtimes. Is the bridge hub embedded ' +
        '(instrumentation.ts registered) and did the Server Component fetch succeed?',
    )
  }

  // Clip to the panel, ending just under the last row. Resizing the viewport
  // instead does not work: the panel is sized in `dvh`, so shrinking the window
  // re-lays it out and the rows move — the trim chases its own tail and ends up
  // slicing through the page heading behind it.
  const clip = await page.evaluate(() => {
    const el = document.querySelector('hakka-inspector')
    const panel = el?.shadowRoot?.querySelector('.hakka-panel')
    const last = [...(el?.shadowRoot?.querySelectorAll('.hakka-row') ?? [])].at(-1)
    if (!panel || !last) return null
    const p = panel.getBoundingClientRect()
    const l = last.getBoundingClientRect()
    return { x: p.x, y: p.y, width: p.width, height: Math.ceil(l.bottom - p.y + 12) }
  })
  if (!clip) fail('could not measure the panel to clip the screenshot')

  await page.screenshot({ path: OUT, clip })
  if (!existsSync(OUT)) fail(`screenshot was not written to ${OUT}`)
  process.stdout.write(`wrote ${path.relative(repoRoot, OUT)}\n`)
} finally {
  await browser.close()
}
