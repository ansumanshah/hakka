/**
 * run-all.mjs: runs both demos in this directory, one after another, and
 * fails the run if either fails its own checks.
 *
 * Each demo has to run as its OWN process, not get imported together into
 * one: `hakkaSpanProcessor()`/`enableTraceSpans()` share module-level state
 * (`registration`, `hakkaSpanProcessorSeen`, see spanProcessor.ts) that
 * isn't meant to host two independent OTel setups in the same process, and
 * `@opentelemetry/api`'s global TracerProvider registration is itself a
 * process-wide singleton (`trace.setGlobalTracerProvider` silently no-ops on
 * a second call without an intervening `disable()`). Same reasoning as
 * examples/framework-servers' own run-all.mjs.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const demos = ['constructor-time.mjs', 'attach-fallback.mjs']

let failed = false
for (const demo of demos) {
  const result = spawnSync(process.execPath, [path.join(dir, demo)], { stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
