// A tiny "app under test" server for the CI-gate worked example. Two
// endpoints, one of which optionally grows a new field to demonstrate a
// FAIL — see README.md.
import http from 'node:http'

export function createServer({ addNewField = false } = {}) {
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
        const payload = { item: 'widget', quantity: 3 }
        if (addNewField) payload.discountCode = 'NEWFIELD' // simulates an unreviewed new field
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ orderId: 'ord_123', ...payload }))
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
