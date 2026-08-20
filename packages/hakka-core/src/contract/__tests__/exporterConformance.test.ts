import { describe, expect, test } from 'bun:test'

import { createAgentContextExporter } from '../../export/agentContext'
import { createAgentEvidenceExporter } from '../../export/agentEvidence'
import { createMswHandlersExporter } from '../../interop/msw'
import { createPlaywrightRoutesExporter } from '../../interop/playwright'
import { createHarExporter } from '../../model/har'
import { createOtelJsonExporter } from '../../model/otel'
import { createPostmanExporter } from '../../model/postman'
import type { NetworkRequest } from '../../model/types'
import { createEvidenceBundleExporter } from '../../repro/buildEvidenceBundle'
import { createReproBundleExporter } from '../../repro/serializeReproBundle'
import { createSessionExporter } from '../../session/serialize'
import { createTestCodegenExporter } from '../../test/codegen'
import { createCurlExporter } from '../../utils/share'
import type { Exporter } from '../exporter'
import { checkExporterConformance, type ExporterProbe } from '../exporterConformance'

function expectFullPass(report: Awaited<ReturnType<typeof checkExporterConformance>>): void {
  const failures = report.checks.filter((c) => !c.passed)
  expect(failures).toEqual([])
  expect(report.passed).toBe(true)
}

/**
 * Every real `Exporter` wrapper (ADR 0009, `exporter.ts`) runs the same
 * conformance harness a third-party exporter would — see LESSON 1 in the
 * task brief this file was written against: a contract with only a sample
 * implementation wrapped is dead weight.
 */
describe('checkExporterConformance — every real wrapper', () => {
  const wrappers: Array<[string, () => Exporter]> = [
    ['hakka.har', createHarExporter],
    ['hakka.otel-json', createOtelJsonExporter],
    ['hakka.postman-collection', createPostmanExporter],
    ['hakka.curl', createCurlExporter],
    ['hakka.agent-context', createAgentContextExporter],
    ['hakka.agent-evidence', createAgentEvidenceExporter],
    ['hakka.evidence-bundle', createEvidenceBundleExporter],
    ['hakka.repro-bundle', createReproBundleExporter],
    ['hakka.session', createSessionExporter],
    ['hakka.playwright-routes', createPlaywrightRoutesExporter],
    ['hakka.msw-handlers', createMswHandlersExporter],
    ['hakka.test-codegen', createTestCodegenExporter],
  ]

  for (const [label, createExporter] of wrappers) {
    test(`${label} passes every check`, async () => {
      const probe: ExporterProbe = { createExporter }
      const report = await checkExporterConformance(probe)
      expectFullPass(report)
    })
  }
})

/**
 * Deliberately broken: ignores its `requests` argument entirely and always
 * returns the same string. Exists to prove the harness actually catches the
 * bug it claims to catch ("output actually depends on the input"), not just
 * exercise the happy path.
 */
function createConstantOutputExporter(): Exporter {
  return {
    id: 'test.broken-constant-output',
    label: 'Broken (constant output)',
    fileExtension: 'txt',
    mimeType: 'text/plain',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export() {
      return 'this never changes no matter what you pass in' // BUG: ignores `requests`
    },
  }
}

describe('checkExporterConformance — catches an exporter that ignores its input', () => {
  test('flags the input-dependence check and only that one', async () => {
    const probe: ExporterProbe = { createExporter: createConstantOutputExporter }
    const report = await checkExporterConformance(probe)
    expect(report.passed).toBe(false)
    const dependenceCheck = report.checks.find((c) => c.name.startsWith('output actually depends on the input'))
    expect(dependenceCheck?.passed).toBe(false)
    // Unrelated checks — identity, empty-input safety — still pass.
    const identityCheck = report.checks.find((c) => c.name === 'identity fields are well-formed')
    expect(identityCheck?.passed).toBe(true)
    const emptyCheck = report.checks.find((c) => c.name === 'export() does not throw for an empty request list')
    expect(emptyCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: declares `includesBodies: false` — telling a
 * redaction-conscious caller "no body text will appear in this output" —
 * but the `export()` implementation embeds the request body anyway. Exists
 * to prove the harness catches a dishonest capability flag, not just a type
 * mismatch.
 */
function createDishonestBodiesExporter(): Exporter {
  return {
    id: 'test.broken-dishonest-bodies',
    label: 'Broken (lies about includesBodies)',
    fileExtension: 'txt',
    mimeType: 'text/plain',
    lossy: true,
    includesBodies: false, // BUG: claims no bodies, but export() below embeds requestBody
    streaming: false,
    export(requests) {
      return requests.map((r) => `${r.method} ${r.url} body=${r.requestBody ?? ''}`).join('\n')
    },
  }
}

describe('checkExporterConformance — catches a dishonest includesBodies flag', () => {
  test('flags the includesBodies check and only that one', async () => {
    const probe: ExporterProbe = { createExporter: createDishonestBodiesExporter }
    const report = await checkExporterConformance(probe)
    expect(report.passed).toBe(false)
    const bodiesCheck = report.checks.find((c) => c.name.startsWith('includesBodies is honest'))
    expect(bodiesCheck?.passed).toBe(false)
    // Unrelated checks — identity, input-dependence (url/method still vary) — still pass.
    const identityCheck = report.checks.find((c) => c.name === 'identity fields are well-formed')
    expect(identityCheck?.passed).toBe(true)
    const dependenceCheck = report.checks.find((c) => c.name.startsWith('output actually depends on the input'))
    expect(dependenceCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: mutates a field on each `NetworkRequest` it's handed
 * instead of only reading it. Exists to prove the harness catches mutation
 * of the caller's own request objects, not just mutation of the array
 * wrapper (which TypeScript's `readonly NetworkRequest[]` already discourages
 * at the array level, but not at the element level).
 */
function createMutatingExporter(): Exporter {
  return {
    id: 'test.broken-mutates-requests',
    label: 'Broken (mutates requests)',
    fileExtension: 'txt',
    mimeType: 'text/plain',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export(requests) {
      for (const r of requests) {
        r.status = 599 // BUG: mutates the caller's own request object in place
      }
      return requests.map((r) => `${r.method} ${r.url} status=${r.status ?? 'none'}`).join('\n')
    },
  }
}

describe('checkExporterConformance — catches an exporter that mutates its input', () => {
  test('flags the mutation check and only that one', async () => {
    const probe: ExporterProbe = { createExporter: createMutatingExporter }
    const report = await checkExporterConformance(probe)
    expect(report.passed).toBe(false)
    const mutationCheck = report.checks.find((c) => c.name.startsWith('export() does not mutate'))
    expect(mutationCheck?.passed).toBe(false)
    // Unrelated checks — identity, input-dependence — still pass.
    const identityCheck = report.checks.find((c) => c.name === 'identity fields are well-formed')
    expect(identityCheck?.passed).toBe(true)
    const dependenceCheck = report.checks.find((c) => c.name.startsWith('output actually depends on the input'))
    expect(dependenceCheck?.passed).toBe(true)
  })
})

/**
 * Deliberately broken: accumulates every request it has ever seen into a
 * MODULE-LEVEL buffer instead of using only the argument passed to THIS
 * call — the exact "accumulates/leaks state across calls" shape the
 * independence clause on `Exporter` (see `exporter.ts`) forbids. The buffer
 * is intentionally declared outside the factory function so it survives
 * across separate `createExporter()` instances too, the way a real
 * module-level leak would.
 */
const leakedBuffer: NetworkRequest[] = []
function createLeakyExporter(): Exporter {
  return {
    id: 'test.broken-leaks-across-calls',
    label: 'Broken (leaks state across calls)',
    fileExtension: 'txt',
    mimeType: 'text/plain',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export(requests) {
      leakedBuffer.push(...requests) // BUG: accumulates instead of using only this call's argument
      return leakedBuffer.map((r) => `${r.method} ${r.url}`).join('\n')
    },
  }
}

describe('checkExporterConformance — catches an exporter that leaks state across calls', () => {
  test('flags the independence check and only that one', async () => {
    const probe: ExporterProbe = { createExporter: createLeakyExporter }
    const report = await checkExporterConformance(probe)
    expect(report.passed).toBe(false)
    const independenceCheck = report.checks.find((c) => c.name.startsWith('two export() calls are independent'))
    expect(independenceCheck?.passed).toBe(false)
    // Unrelated checks — identity, mutation (this exporter only reads requests) — still pass.
    const identityCheck = report.checks.find((c) => c.name === 'identity fields are well-formed')
    expect(identityCheck?.passed).toBe(true)
    const mutationCheck = report.checks.find((c) => c.name.startsWith('export() does not mutate'))
    expect(mutationCheck?.passed).toBe(true)
  })
})
