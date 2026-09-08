import http from 'node:http'

const port = Number(process.env.HAKKA_RN_BENCHMARK_PORT ?? 4177)

const server = http.createServer((request, response) => {
  const match = request.url?.match(/^\/payload\/(0|256|16384)(?:\?|$)/)
  if (!match) {
    response.writeHead(request.url === '/health' ? 200 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: request.url === '/health' }))
    return
  }
  const length = Number(match[1])
  const body = 'x'.repeat(length)
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    'content-type': 'text/plain; charset=utf-8',
    'x-hakka-rn-benchmark': '1',
  })
  response.end(body)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Hakka RN benchmark server listening on http://127.0.0.1:${port}`)
})
