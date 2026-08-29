import http from 'node:http'

/**
 * A tiny "downstream API" every framework demo calls outbound to. This
 * outbound call — not the incoming request to the demo server itself — is
 * what hakka-node captures: it instruments outbound `fetch`/`http`, not a
 * server's own request listener.
 */
export function startUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 1, name: 'Ada Lovelace', source: 'upstream-api' }))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}
