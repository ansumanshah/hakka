import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { datasets } from './datasets.js'
import { execute } from './executeRequest.js'
import { junit } from './junit.js'
import { loadCollection } from './loadCollection.js'
import type { RunOptions, RunReport, RunItem } from './types.js'
import { hasScripts, throwIfAborted } from './values.js'
export type { RunOptions, RunReport } from './types.js'
/** Execute an authored Hakka collection with no secret values in stdout or reports. */
export async function runCollection(input: string, options: RunOptions = {}): Promise<RunReport> {
  throwIfAborted(options.signal)
  const { collection, requests } = await loadCollection(input, options.folder)
  if (!requests.length) throw new Error('collection contains no runnable requests')
  const rows = await datasets(options.dataFile)
  if (!rows.length) throw new Error('dataset contains no rows')
  const repeats = positiveInteger(options.repeat ?? 1, '--repeat', 10_000)
  const delayMs = nonNegativeInteger(options.delayMs ?? 0, '--delay-ms', 3_600_000)
  const timeoutMs = positiveInteger(options.timeoutMs ?? 30_000, '--timeout-ms', 3_600_000)
  if (options.allowScripts === false && requests.some(({ request }) => hasScripts(request)))
    throw new Error('collection contains scripts, which are disabled for this execution')
  const started = Date.now()
  const items: RunItem[] = []
  for (let repeat = 0; repeat < repeats; repeat++)
    for (const row of rows) {
      const variables = { ...options.environment, ...row }
      for (const request of requests) {
        throwIfAborted(options.signal)
        items.push(await execute(request, variables, timeoutMs, options.signal))
      }
      if (delayMs && (repeat < repeats - 1 || row !== rows.at(-1)))
        await delay(delayMs, undefined, { signal: options.signal }).catch((error: unknown) => {
          if (options.signal?.aborted) throw new DOMException('run cancelled', 'AbortError')
          throw error
        })
    }
  const report: RunReport = {
    collection: collection.name,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    iterations: repeats * rows.length,
    passed: items.filter((item) => item.outcome === 'passed').length,
    failed: items.filter((item) => item.outcome !== 'passed').length,
    items,
  }
  if (options.jsonReport) {
    await mkdir(dirname(resolve(options.jsonReport)), { recursive: true })
    await writeFile(options.jsonReport, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (options.junitReport) {
    await mkdir(dirname(resolve(options.junitReport)), { recursive: true })
    await writeFile(options.junitReport, junit(report))
  }
  return report
}

function positiveInteger(value: number, flag: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${flag} must be an integer from 1 to ${maximum}`)
  return value
}
function nonNegativeInteger(value: number, flag: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new Error(`${flag} must be an integer from 0 to ${maximum}`)
  return value
}

/** CLI adapter. The parent CLI owns command routing; this owns the run grammar. */
