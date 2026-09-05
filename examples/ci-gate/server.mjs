// A tiny "app under test" backend for the CI-gate worked example: two
// endpoints that `ciGate.test.ts`'s `exerciseApp` calls. Deliberately
// passive — the FAIL scenario this feature demonstrates is a CLIENT sending
// a new REQUEST-body field it never sent before (requirement #4 in the repo
// prompt, verbatim), and `diffBaseline` only ever looks at request bodies
// (see `hakka-node/src/ci/normalize.ts`), never responses. So the toggle
// that produces it lives on the caller's side, in `exerciseApp`, not here.
import http from 'node:http'

export function createServer() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.startsWith('/users/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: req.url.split('/')[2], name: 'Ada Lovelace' }))
        return
      }
      if (req.method === 'POST' && req.url === '/orders') {
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ orderId: 'ord_123', item: 'widget', quantity: 3 }))
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
}

export function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}
