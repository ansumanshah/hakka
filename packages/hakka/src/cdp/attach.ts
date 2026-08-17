/**
 * `hakka cdp` subcommand implementation — attaches to a live Chrome/Chromium
 * instance over its DevTools Protocol debugging port and streams `Network`
 * captures to a Hakka bridge hub. No Playwright/Puppeteer dependency.
 */
import './wsCompat.js'
import WebSocket from 'ws'

import { bridge } from './bridgeClient.js'
import { createCdpCapture } from './capture.js'
import type { CdpTransport } from './types.js'

export interface CdpAttachOptions {
  /** Explicit CDP debugger WebSocket URL (ws://.../devtools/page/<id>). Takes priority over port/target discovery. */
  url?: string
  /** Chrome's --remote-debugging-port to discover a target on. Default: 9222. */
  port?: number
  /** Case-insensitive substring match against a discovered target's url/title. First 'page' target wins when omitted. */
  target?: string
  /** Bridge hub URL to stream captures to. Default: ws://localhost:8989. */
  bridgeUrl?: string
  captureBody?: boolean
  maxBodySize?: number
}

interface CdpTargetInfo {
  id: string
  type: string
  title?: string
  url?: string
  webSocketDebuggerUrl?: string
}

/** Fetch the list of debuggable targets from Chrome's HTTP DevTools endpoint and pick one. */
async function discoverTarget(port: number, targetFilter?: string): Promise<CdpTargetInfo> {
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${port}/json/list`)
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Couldn't reach the Chrome debugging endpoint at :${port} (${reason}) — is Chrome running with ` +
        `--remote-debugging-port=${port}? Or pass --url with an explicit ws://.../devtools/page/<id>.`,
    )
  }
  if (!res.ok) {
    throw new Error(`Chrome debugging endpoint at :${port} responded ${res.status} ${res.statusText}`)
  }
  const targets = (await res.json()) as CdpTargetInfo[]
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (pages.length === 0) {
    throw new Error(
      `No debuggable page targets found on :${port} — is Chrome running with --remote-debugging-port=${port}?`,
    )
  }
  if (targetFilter) {
    const needle = targetFilter.toLowerCase()
    const match = pages.find((t) => t.url?.toLowerCase().includes(needle) || t.title?.toLowerCase().includes(needle))
    if (!match) {
      throw new Error(`No target on :${port} matched "${targetFilter}" (found: ${pages.map((t) => t.url).join(', ')})`)
    }
    return match
  }
  return pages[0]!
}

/**
 * Raw WebSocket CdpTransport — JSON-RPC id correlation over `ws`. Exported
 * for `attach.test.ts` only; not re-exported from the package's `./cdp` entry point.
 */
export function createWsTransport(debuggerUrl: string): {
  transport: CdpTransport
  socket: WebSocket
  ready: Promise<void>
} {
  const socket = new WebSocket(debuggerUrl)
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(params: unknown) => void>>()
  let nextId = 1

  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))))
  })

  // Settle in-flight sends when the socket dies — `stop()` sends CDP commands
  // over a dead socket on shutdown, and without this its promise never resolves.
  socket.on('close', () => {
    const err = new Error('CDP socket closed')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  })

  socket.on('message', (data) => {
    let msg: unknown
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
    } catch {
      return
    }
    if (msg === null || typeof msg !== 'object') return
    const m = msg as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown }
    if (typeof m.id === 'number') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error.message ?? 'CDP error'))
      else p.resolve(m.result)
      return
    }
    if (typeof m.method === 'string') {
      for (const cb of listeners.get(m.method) ?? []) cb(m.params)
    }
  })

  const transport: CdpTransport = {
    send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        try {
          socket.send(JSON.stringify({ id, method, params }))
        } catch (err) {
          pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(cb)
    },
    off(event, cb) {
      listeners.get(event)?.delete(cb)
    },
  }

  return { transport, socket, ready }
}

/**
 * Attaches, captures, and streams until SIGINT/SIGTERM or the debuggee's
 * socket closes, then cleans up. Doesn't touch stdin, unlike `hakka mcp`.
 */
export async function runCdpAttach(opts: CdpAttachOptions): Promise<void> {
  const port = opts.port ?? 9222
  const bridgeUrl = opts.bridgeUrl ?? 'ws://localhost:8989'

  let debuggerUrl = opts.url
  if (!debuggerUrl) {
    const target = await discoverTarget(port, opts.target)
    debuggerUrl = target.webSocketDebuggerUrl
    process.stdout.write(`Attaching to ${target.title ?? target.url ?? target.id} (${debuggerUrl})\n`)
  }
  if (!debuggerUrl) throw new Error('No debugger URL resolved')

  const { transport, socket, ready } = createWsTransport(debuggerUrl)
  await ready

  const client = bridge(bridgeUrl)
  const capture = createCdpCapture({
    transport,
    onRequest: client.send,
    ...(opts.captureBody !== undefined ? { captureBody: opts.captureBody } : {}),
    ...(opts.maxBodySize !== undefined ? { maxBodySize: opts.maxBodySize } : {}),
  })
  await capture.start()
  process.stdout.write(`Capturing Network traffic → ${bridgeUrl} (Ctrl+C to stop)\n`)

  await new Promise<void>((resolve) => {
    let settled = false
    const shutdown = (): void => {
      if (settled) return
      settled = true
      process.stdout.write('\nStopping capture…\n')
      void capture
        .stop()
        .catch(() => {})
        .finally(() => {
          client.close()
          socket.close()
          resolve()
        })
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    socket.on('close', shutdown)
  })
}
