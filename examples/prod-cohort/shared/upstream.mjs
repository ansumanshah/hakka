import http from 'node:http'

/**
 * A tiny "notes" API standing in for the internal service the prod app calls
 * outbound to. `POST /notes` echoes the submitted note back with an added
 * `token` field (a made-up per-note access token), deliberately named to
 * collide with `PROD_DEFAULT_BODY_REDACT_FIELDS` ('password', 'token') on
 * BOTH sides of the hop, so demo.mjs can prove redaction on the app's
 * outbound REQUEST body and this upstream's RESPONSE body in one call.
 *
 * Anything else (used by demo.mjs's `/admin/*` case) returns 200 with an
 * unrelated body: reachable over HTTP, just never on `captureUrls`.
 */
export function startUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/notes') {
        let raw = ''
        req.on('data', (chunk) => (raw += chunk))
        req.on('end', () => {
          let submitted = {}
          try {
            submitted = JSON.parse(raw)
          } catch {
            /* malformed body: fall through with the empty object */
          }
          const stored = { id: 'note-1', ...submitted, token: 'note-access-token-xyz789' }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(stored))
        })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ secret: 'admin-only-data' }))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}
