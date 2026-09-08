import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const port = 43177
const child = spawn(process.execPath, [fileURLToPath(new URL('./local-server.mjs', import.meta.url))], {
  env: { ...process.env, HAKKA_RN_BENCHMARK_PORT: String(port) },
  stdio: 'ignore',
})

try {
  await waitForServer(port)
  await Promise.all(
    [0, 256, 16_384].map(async (size) => {
      const response = await fetch(`http://127.0.0.1:${port}/payload/${size}`)
      assert.equal(response.status, 200)
      assert.equal(Number(response.headers.get('content-length')), size)
      assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
      assert.equal(await response.text(), 'x'.repeat(size))
    }),
  )
  console.log('RN benchmark local server verified: 0 B, 256 B, and 16 KiB payloads')
} finally {
  child.kill()
}

async function waitForServer(port) {
  let lastError
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    // Startup can be slower on a machine with a concurrent native build.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError ?? new Error('benchmark server did not become ready')
}
