/**
 * A tiny, self-contained API for the panel to call — no external network
 * dependency, so the demo works offline and every request lands same-origin
 * (no CORS to configure). Wired into Vite's dev server as middleware in
 * `vite.config.ts`, the same way a real backend sits behind your app.
 *
 * Every route is deliberately shaped to give the panel something worth
 * looking at: a fast happy path, one endpoint that's always slow, one that's
 * always a 500, and a POST that echoes its body — enough variety that the
 * filter bar, the status/duration tint gates, and the stats panel all have
 * real signal to show, not a wall of identical 200s.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Connect } from 'vite'

const USERS = [
  { id: 1, name: 'Priya Nair', role: 'admin' },
  { id: 2, name: 'Kenji Watanabe', role: 'member' },
  { id: 3, name: 'Amara Okafor', role: 'member' },
  { id: 4, name: 'Diego Fuentes', role: 'viewer' },
]

function json(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** Small deterministic jitter so latency looks real without making any
 * assertion about this demo unreliable — always within a fixed band. */
function jitter(baseMs: number, spreadMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, baseMs + Math.random() * spreadMs))
}

export function installDemoApi(middlewares: Connect.Server): void {
  middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    // GET /api/users — the fast happy path.
    if (pathname === '/api/users' && req.method === 'GET') {
      await jitter(40, 60)
      json(res, 200, USERS)
      return
    }

    // GET /api/users/:id — 200 for a known id, a real 404 otherwise.
    const userMatch = /^\/api\/users\/(\d+)$/.exec(pathname)
    if (userMatch && req.method === 'GET') {
      await jitter(30, 40)
      const id = Number(userMatch[1])
      const user = USERS.find((u) => u.id === id)
      if (!user) {
        json(res, 404, { error: `no user with id ${id}` })
        return
      }
      json(res, 200, user)
      return
    }

    // POST /api/orders — echoes the request body back with an assigned id.
    if (pathname === '/api/orders' && req.method === 'POST') {
      await jitter(50, 70)
      const raw = await readBody(req)
      let order: unknown = null
      try {
        order = raw ? JSON.parse(raw) : null
      } catch {
        json(res, 400, { error: 'invalid JSON body' })
        return
      }
      json(res, 201, {
        id: `order_${Date.now()}`,
        status: 'confirmed',
        ...(order && typeof order === 'object' ? order : {}),
      })
      return
    }

    // GET /api/reports/summary — always slow, to show up "hot" in the
    // duration column and pull the stats panel's p95 up.
    if (pathname === '/api/reports/summary' && req.method === 'GET') {
      await jitter(850, 150)
      json(res, 200, {
        generatedAt: new Date().toISOString(),
        totalUsers: USERS.length,
        activeToday: 3,
        revenueCents: 482_311,
      })
      return
    }

    // GET /api/payments/charge — always fails. A real "something broke"
    // row for the error-rate stat and the status:5 filter chip.
    if (pathname === '/api/payments/charge' && req.method === 'GET') {
      await jitter(60, 40)
      json(res, 500, { error: 'payment provider timeout', code: 'UPSTREAM_TIMEOUT' })
      return
    }

    // GET /api/legacy/ping — same happy path as /api/users, but this one's
    // called via XMLHttpRequest from the panel (source: 'xhr' vs 'fetch').
    if (pathname === '/api/legacy/ping' && req.method === 'GET') {
      await jitter(35, 30)
      json(res, 200, { pong: true, via: 'xhr' })
      return
    }

    next()
  })
}
