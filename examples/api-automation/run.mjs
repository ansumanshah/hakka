import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const collection = fileURLToPath(new URL('.', import.meta.url))
const cli = fileURLToPath(new URL('../../packages/hakka-cli/dist/cli.mjs', import.meta.url))
const users = new Map()
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json')
  if (request.method === 'POST' && request.url === '/users') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const user = { ...JSON.parse(Buffer.concat(chunks).toString()), id: String(users.size + 1) }
    users.set(user.id, user)
    response.writeHead(201).end(JSON.stringify(user))
    return
  }
  const user = users.get(request.url?.split('/').at(-1))
  response.writeHead(user ? 200 : 404).end(JSON.stringify(user ?? { error: 'not found' }))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const child = spawn(
    process.execPath,
    [cli, 'run', collection, '--env', `BASE_URL=http://127.0.0.1:${server.address().port}`, '--json'],
    { stdio: 'inherit' },
  )
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  await new Promise((resolve) => server.close(resolve))
}
