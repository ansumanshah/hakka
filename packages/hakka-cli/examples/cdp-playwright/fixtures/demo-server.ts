/**
 * Fixture app for the CDP capture example: a page that fires three `fetch()`
 * calls on load — two succeed, one 404s — so the test has deterministic
 * traffic to capture and assert on. Plain `node:http`, no framework, no
 * external requests, so the test never depends on network being reachable
 * or fights another process for a fixed port (`listen(0, ...)` picks a free
 * one).
 */
import { createServer, type ServerResponse } from 'node:http'

export interface DemoServer {
  url: string
  close(): Promise<void>
}

const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Hakka CDP capture fixture</title>
<style>
  :root {
    --demo-bg: #121110;
    --demo-text: #edeae4;
    --demo-font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  body {
    background: var(--demo-bg);
    color: var(--demo-text);
    font-family: var(--demo-font-sans);
    padding: 2rem;
  }
</style>
</head>
<body>
  <h1 id="status">loading…</h1>
  <script>
    Promise.allSettled([
      fetch('/api/users'),
      fetch('/api/orders'),
      fetch('/api/missing'),
    ]).then(() => {
      document.getElementById('status').textContent = 'done'
    })
  </script>
</body>
</html>`

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Starts the fixture server on an OS-assigned port and returns its URL plus a `close()`. */
export function startDemoServer(): Promise<DemoServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    switch (url.pathname) {
      case '/':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(PAGE_HTML)
        return
      case '/api/users':
        json(res, 200, [
          { id: 1, name: 'Ada Lovelace' },
          { id: 2, name: 'Grace Hopper' },
        ])
        return
      case '/api/orders':
        json(res, 200, [{ id: 101, total: 42 }])
        return
      case '/api/missing':
        json(res, 404, { error: 'not found' })
        return
      default:
        res.writeHead(404)
        res.end('not found')
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}
