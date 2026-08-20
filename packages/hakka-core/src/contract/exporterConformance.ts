/**
 * A runnable check that an `Exporter` implementation honors the contract
 * documented on `Exporter` (see `exporter.ts`). A third party implementing
 * the interface can run `checkExporterConformance` against their own
 * exporter the same way `exporterConformance.test.ts` runs it against the
 * wrappers defined in this repo.
 *
 * Unlike `CaptureSourceProbe`, an `ExporterProbe` needs no per-implementation
 * "trigger" hook — every `Exporter.export()` takes the same shape of input
 * (`readonly NetworkRequest[]`, a publicly constructible type), so the
 * harness builds its own fixtures rather than asking the probe how to
 * synthesize one.
 */

import type { NetworkRequest } from '../model/types'
import type { ConformanceCheck, ConformanceReport } from './conformance'
import type { Exporter } from './exporter'

/** How a conformance run drives the exporter under test. */
export interface ExporterProbe {
  /** Construct a new `Exporter` instance to test. */
  createExporter(): Exporter
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function runCheck(name: string, fn: () => Promise<void> | void): Promise<ConformanceCheck> {
  try {
    await fn()
    return { name, passed: true }
  } catch (error: unknown) {
    return { name, passed: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

let fixtureCounter = 0

/** A minimal, valid `NetworkRequest` — only the fields the interface requires plus whatever the caller overrides. */
function fixtureRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  fixtureCounter += 1
  return {
    id: `exporter-conformance-${fixtureCounter}`,
    url: `https://example.test/conformance/${fixtureCounter}`,
    method: 'GET',
    startTime: 1_700_000_000_000 + fixtureCounter,
    status: 200,
    ...overrides,
  }
}

/**
 * Run every conformance check against `probe` and return a report. Each
 * check builds a fresh exporter instance and fresh fixture requests, so one
 * failure never cascades into unrelated false failures.
 */
export async function checkExporterConformance(probe: ExporterProbe): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = []

  checks.push(
    await runCheck('identity fields are well-formed', () => {
      const exporter = probe.createExporter()
      assert(typeof exporter.id === 'string' && exporter.id.length > 0, 'id must be a non-empty string')
      assert(typeof exporter.label === 'string' && exporter.label.length > 0, 'label must be a non-empty string')
      assert(
        typeof exporter.fileExtension === 'string' && exporter.fileExtension.length > 0,
        'fileExtension must be a non-empty string',
      )
      assert(!exporter.fileExtension.startsWith('.'), 'fileExtension must not start with a leading dot')
      assert(
        typeof exporter.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(exporter.mimeType),
        `mimeType must look like "type/subtype", got ${JSON.stringify(exporter.mimeType)}`,
      )
      assert(typeof exporter.lossy === 'boolean', 'lossy must be a boolean')
      assert(typeof exporter.includesBodies === 'boolean', 'includesBodies must be a boolean')
      assert(typeof exporter.streaming === 'boolean', 'streaming must be a boolean')
    }),
  )

  checks.push(
    await runCheck('export() does not throw for an empty request list', async () => {
      const exporter = probe.createExporter()
      const output = await exporter.export([])
      assert(typeof output === 'string', `expected export([]) to resolve to a string, got ${typeof output}`)
    }),
  )

  checks.push(
    await runCheck('export() does not throw and returns non-empty output for real requests', async () => {
      const exporter = probe.createExporter()
      const output = await exporter.export([fixtureRequest(), fixtureRequest({ method: 'POST', status: 500 })])
      assert(typeof output === 'string', `expected export() to resolve to a string, got ${typeof output}`)
      assert(output.length > 0, 'expected non-empty output for a non-empty request list')
    }),
  )

  checks.push(
    await runCheck('output actually depends on the input, not a hardcoded constant', async () => {
      const exporter = probe.createExporter()
      const requestA = fixtureRequest({ url: 'https://example.test/conformance/aaaaaaaaaaaa', method: 'GET' })
      const requestB = fixtureRequest({ url: 'https://example.test/conformance/bbbbbbbbbbbb', method: 'DELETE' })
      const outputA = await exporter.export([requestA])
      const outputB = await exporter.export([requestB])
      assert(
        outputA !== outputB,
        'export() produced identical output for two structurally different request sets — it must be ignoring its argument',
      )
    }),
  )

  checks.push(
    await runCheck('includesBodies is honest about request body text', async () => {
      const exporter = probe.createExporter()
      const marker = `HAKKA_CONFORMANCE_BODY_MARKER_${++fixtureCounter}`
      const withBody = fixtureRequest({
        method: 'POST',
        requestBody: marker,
        requestHeaders: { 'Content-Type': 'application/json' },
      })
      const output = await exporter.export([withBody])
      const containsMarker = output.includes(marker)
      if (exporter.includesBodies) {
        assert(containsMarker, 'includesBodies is true but the request body marker is not recoverable from the output')
      } else {
        assert(!containsMarker, 'includesBodies is false but the request body marker leaked into the output')
      }
    }),
  )

  checks.push(
    await runCheck('export() does not mutate requests or any of its elements', async () => {
      const exporter = probe.createExporter()
      const requests = [
        fixtureRequest({
          requestHeaders: { 'X-Test': 'a' },
          responseHeaders: { 'X-Resp': 'b' },
          redirectChain: ['https://example.test/conformance/redirect-1'],
        }),
        fixtureRequest({ method: 'POST', status: 500, requestBody: 'do-not-mutate-me' }),
      ]
      // Snapshot before, compare after — no cloning needed, since a mutation
      // (element field changed, array reordered/spliced) shows up as a diff
      // against this same string either way.
      const before = JSON.stringify(requests)
      await exporter.export(requests)
      const after = JSON.stringify(requests)
      assert(before === after, 'export() mutated the requests array or one of its elements')
    }),
  )

  checks.push(
    await runCheck('two export() calls are independent — no state leaks across calls', async () => {
      // Reuses ONE exporter instance across two calls — the bug this guards
      // against (a module-level buffer, or any state keyed only by call
      // order) is invisible if each call gets its own fresh instance.
      const exporter = probe.createExporter()
      const firstCallMarker = `first-call-only-${++fixtureCounter}`
      await exporter.export([
        fixtureRequest({ url: `https://example.test/conformance/${firstCallMarker}`, method: 'PUT' }),
      ])
      const secondCallMarker = `second-call-only-${++fixtureCounter}`
      const secondOutput = await exporter.export([
        fixtureRequest({ url: `https://example.test/conformance/${secondCallMarker}`, method: 'GET' }),
      ])
      // Deliberately NOT an equality check between two identical-input calls —
      // several real wrappers embed a wall-clock "exported at" timestamp per
      // call, so identical input can legitimately produce different output.
      // The actual guarantee is narrower: nothing from an EARLIER call's
      // arguments may show up in a LATER call's output.
      assert(
        !secondOutput.includes(firstCallMarker),
        "a later export() call's output contains data from an earlier, unrelated call — state is leaking across calls",
      )
    }),
  )

  return { passed: checks.every((c) => c.passed), checks }
}
