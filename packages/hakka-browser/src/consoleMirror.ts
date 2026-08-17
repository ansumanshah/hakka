/**
 * consoleMirror — opt-in rich console output for captured network requests.
 *
 * When enabled, each request that passes through the Hakka ring buffer is
 * mirrored to the page's real DevTools console using console.groupCollapsed /
 * console.table / %c styling. This lets you see Hakka data in the DevTools
 * Network-style view even without opening the overlay.
 *
 * Toggle via `start({ logToConsole: true })` or the Settings tab at runtime.
 */

import type { NetworkRequest } from 'hakka-core'

import { store } from './worker'

// Palette — status code colours matching the overlay's design tokens.
const COLOR = {
  method: 'color:#60a5fa;font-weight:700',
  ok: 'color:#4ade80;font-weight:700',
  redirect: 'color:#facc15;font-weight:700',
  error: 'color:#f87171;font-weight:700',
  pending: 'color:#94a3b8;font-weight:700',
  label: 'color:#94a3b8;font-weight:400',
  url: 'color:#e2e8f0;font-weight:400',
  reset: 'color:inherit;font-weight:400',
} as const

function statusColor(status: number | null | undefined): string {
  if (status == null) return COLOR.pending
  if (status >= 200 && status < 300) return COLOR.ok
  if (status >= 300 && status < 400) return COLOR.redirect
  return COLOR.error
}

function formatDur(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Mirror a single request to the DevTools console. */
export function mirrorToConsole(req: NetworkRequest): void {
  const statusStr = req.status != null ? String(req.status) : 'pending'
  const dur = formatDur(req.duration)
  const sc = statusColor(req.status)

  try {
    const path = (() => {
      try {
        return new URL(req.url).pathname
      } catch {
        return req.url
      }
    })()

    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `%c${req.method}%c %c${statusStr}%c  ${path}  %c${dur}`,
      COLOR.method,
      COLOR.reset,
      sc,
      COLOR.reset,
      COLOR.label,
    )

    // eslint-disable-next-line no-console
    console.table({
      url: req.url,
      method: req.method,
      status: req.status ?? 'pending',
      duration: dur,
      size: req.responseBodySize != null ? `${req.responseBodySize}B` : '-',
      type: req.contentType ?? '-',
    })

    const t = req.timing ?? {}
    const hasTiming = Object.values(t).some((v) => v != null)
    if (hasTiming) {
      // eslint-disable-next-line no-console
      console.groupCollapsed('%cTiming', COLOR.label)
      // eslint-disable-next-line no-console
      console.table({
        dns: formatDur(t.dnsMs),
        tcp: formatDur(t.connectMs),
        tls: formatDur(t.tlsMs),
        ttfb: formatDur(t.ttfbMs),
        download: formatDur(t.downloadMs),
        total: formatDur(t.total ?? req.duration),
      })
      // eslint-disable-next-line no-console
      console.groupEnd()
    }

    if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
      // eslint-disable-next-line no-console
      console.groupCollapsed('%cResponse headers', COLOR.label)
      // eslint-disable-next-line no-console
      console.table(req.responseHeaders)
      // eslint-disable-next-line no-console
      console.groupEnd()
    }

    // eslint-disable-next-line no-console
    console.groupEnd()
  } catch {
    // Swallow: console mirroring is best-effort and must never throw.
  }
}

let _unsub: (() => void) | null = null
let _teardown: (() => void) | null = null

/** Enable console mirroring for all subsequent requests. Returns a teardown. */
export function enableConsoleMirror(): () => void {
  if (_unsub && _teardown) return _teardown

  // Opt-in (logToConsole) — the always-on echo cost is only paid once the
  // developer explicitly turns this on.
  _unsub = store().subscribe((req: NetworkRequest) => {
    if (req.status != null || req.error != null) {
      mirrorToConsole(req)
    }
  })

  _teardown = () => {
    _unsub?.()
    _unsub = null
    _teardown = null
  }

  return _teardown
}

/** Disable console mirroring. */
export function disableConsoleMirror(): void {
  _unsub?.()
  _unsub = null
  _teardown = null
}

/** True when console mirroring is active. */
export function isConsoleMirrorEnabled(): boolean {
  return _unsub !== null
}
