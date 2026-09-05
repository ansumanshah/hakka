/**
 * run-all.mjs — runs every framework demo in this directory, one after
 * another, and fails the run if any of them fails its own trace-correlation
 * check.
 *
 * Each demo has to run as its OWN process, not get imported together into
 * one: hakka-node's startCapture()/register() hold one process-wide capture
 * singleton (`active` in serverCapture.ts) — a second startCapture() call in
 * the same process just returns the first demo's handle instead of starting
 * a fresh one, which would silently break every demo after the first.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const demos = ['raw-http.mjs', 'express.mjs', 'fastify.mjs', 'hono.mjs']

let failed = false
for (const demo of demos) {
  const result = spawnSync(process.execPath, [path.join(dir, demo)], { stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
