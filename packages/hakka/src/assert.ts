/**
 * `hakka assert <file>` — load a saved `.hakka` session or a `.har` capture,
 * run the shared `analyzeRequests` engine, and exit non-zero when configured
 * thresholds are violated. Built for CI gating (e.g. "fail the build if this
 * recorded session has a failing request or a leaked secret").
 *
 * Exit codes:
 *   0 — pass (no threshold violated)
 *   1 — fail (a threshold was violated)
 *   2 — bad input (missing file, unreadable, unparseable)
 */
import { analyzeRequests, type DiagnosisFinding, type NetworkRequest, type RequestDiagnosis } from 'hakka-core'

import { loadRequestsFromFile } from './diagnose'

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
}
const log = (s = '') => process.stdout.write(s + '\n')
const logErr = (s = '') => process.stderr.write(s + '\n')

export interface AssertOptions {
  /** Fail if more than this many requests failed (error or status >= 400). Default 0. */
  maxFailures?: number
  /** Fail if any request took longer than this (ms). */
  maxDurationMs?: number
  /** Fail if any `secret-in-body` finding is present. */
  failOnSecrets?: boolean
  /** Fail if the p95 request duration (ms) exceeds this budget. */
  budgetP95Ms?: number
  /** Passed straight through to analyzeRequests (e.g. --slow-ms). */
  slowMs?: number
}

export interface AssertViolation {
  rule: string
  message: string
}

export interface AssertResult {
  diagnosis: RequestDiagnosis
  violations: AssertViolation[]
}

/** 95th-percentile duration (ms) over timed requests, nearest-rank method. Undefined when no timed requests exist. */
export function computeP95DurationMs(requests: readonly NetworkRequest[]): number | undefined {
  const durations = requests
    .map((r) => r.duration)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)
  if (durations.length === 0) return undefined
  const idx = Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)
  return durations[Math.max(0, idx)]
}

/** Evaluate a diagnosis + the raw requests against the configured thresholds. Pure — no I/O. */
export function evaluateAssertions(
  requests: readonly NetworkRequest[],
  diagnosis: RequestDiagnosis,
  options: AssertOptions,
): AssertViolation[] {
  const violations: AssertViolation[] = []
  const maxFailures = options.maxFailures ?? 0

  if (diagnosis.failed > maxFailures) {
    violations.push({
      rule: 'max-failures',
      message: `${diagnosis.failed} request${diagnosis.failed === 1 ? '' : 's'} failed (max allowed: ${maxFailures})`,
    })
  }

  if (options.maxDurationMs != null) {
    const slowest = requests
      .filter((r) => r.duration != null && r.duration > options.maxDurationMs!)
      .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    if (slowest.length > 0) {
      const worst = slowest[0]!
      violations.push({
        rule: 'max-duration-ms',
        message: `${slowest.length} request${slowest.length === 1 ? '' : 's'} exceeded ${options.maxDurationMs}ms (slowest: ${Math.round(worst.duration ?? 0)}ms ${worst.url})`,
      })
    }
  }

  if (options.failOnSecrets) {
    const secretFindings = diagnosis.findings.filter((f: DiagnosisFinding) => f.kind === 'secret-in-body')
    if (secretFindings.length > 0) {
      violations.push({
        rule: 'fail-on-secrets',
        message: `${secretFindings.length} request${secretFindings.length === 1 ? '' : 's'} leaked a plaintext secret in the body`,
      })
    }
  }

  if (options.budgetP95Ms != null) {
    const p95 = computeP95DurationMs(requests)
    if (p95 != null && p95 > options.budgetP95Ms) {
      violations.push({
        rule: 'budget-p95-ms',
        message: `p95 duration ${Math.round(p95)}ms exceeded budget of ${options.budgetP95Ms}ms`,
      })
    }
  }

  return violations
}

/** A single-request outcome expectation, e.g. "did the replayed request now return 200". */
export interface ReplayExpectation {
  status?: number
  bodyContains?: string
}

/** Evaluate one already-replayed request against an outcome expectation. Pure, no I/O — used by verify_fix. */
export function evaluateOutcome(replayed: NetworkRequest, expect: ReplayExpectation): AssertViolation[] {
  const violations: AssertViolation[] = []

  if (expect.status !== undefined && replayed.status !== expect.status) {
    violations.push({
      rule: 'expect-status',
      message: `expected status ${expect.status}, got ${replayed.status ?? 'none'}`,
    })
  }

  if (expect.bodyContains !== undefined) {
    const body = replayed.responseBody ?? ''
    if (!body.includes(expect.bodyContains)) {
      violations.push({
        rule: 'expect-body-contains',
        message: `expected response body to contain ${JSON.stringify(expect.bodyContains)}, it did not`,
      })
    }
  }

  return violations
}

function formatFinding(f: DiagnosisFinding): string {
  const badge = f.severity === 'error' ? c.red('error') : f.severity === 'warning' ? c.yellow('warn ') : c.dim('info ')
  return `  ${badge}  ${f.message}`
}

function printReport(
  diagnosis: RequestDiagnosis,
  violations: AssertViolation[],
  sourcePath: string,
  relevantFindings: DiagnosisFinding[],
): void {
  log()
  log(`${c.bold('Hakka assert')} ${c.dim(sourcePath)}`)
  log()
  log(c.bold('Summary'))
  log(`  ${diagnosis.summary}`)
  log()

  if (relevantFindings.length > 0) {
    log(c.bold(`Findings ${c.dim(`(${relevantFindings.length})`)}`))
    for (const f of relevantFindings) log(formatFinding(f))
    log()
  }

  if (violations.length === 0) {
    log(`${c.green('PASS')} — all thresholds satisfied.`)
  } else {
    log(`${c.red('FAIL')} — ${violations.length} threshold${violations.length === 1 ? '' : 's'} violated:`)
    for (const v of violations) log(`  ${c.red('•')} ${c.bold(v.rule)}: ${v.message}`)
  }
  log()
}

/** Flags that consume the following token as their value — the positional file path scan must skip over both. */
const VALUED_FLAGS = new Set(['--max-failures', '--max-duration-ms', '--budget-p95-ms', '--slow-ms'])

/** Parse `--flag <value>` / boolean-flag CLI args into AssertOptions. */
export function parseAssertArgs(args: string[]): { filePath: string | undefined; options: AssertOptions } {
  let filePath: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a?.startsWith('--')) {
      if (VALUED_FLAGS.has(a)) i++ // skip its value operand too
      continue
    }
    filePath = a
    break
  }
  const numFlag = (name: string): number | undefined => {
    const idx = args.indexOf(name)
    if (idx === -1 || args[idx + 1] === undefined) return undefined
    const n = Number(args[idx + 1])
    return Number.isNaN(n) ? undefined : n
  }
  const options: AssertOptions = {
    maxFailures: numFlag('--max-failures') ?? 0,
    maxDurationMs: numFlag('--max-duration-ms'),
    failOnSecrets: args.includes('--fail-on-secrets'),
    budgetP95Ms: numFlag('--budget-p95-ms'),
    slowMs: numFlag('--slow-ms'),
  }
  return { filePath, options }
}

function assertUsage(): void {
  logErr(
    `Usage: ${c.cyan(
      'hakka assert <file.hakka|file.har>',
    )} ${c.dim('[--max-failures <n>] [--max-duration-ms <n>] [--fail-on-secrets] [--budget-p95-ms <n>]')}`,
  )
}

/** `hakka assert` entrypoint. Sets process.exitCode (0 pass / 1 fail / 2 bad input) — does not call process.exit. */
export function assertCommand(filePath: string | undefined, options: AssertOptions = {}): AssertResult | undefined {
  if (!filePath) {
    assertUsage()
    process.exitCode = 2
    return undefined
  }

  let requests: NetworkRequest[]
  try {
    requests = loadRequestsFromFile(filePath)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    logErr(`${c.red('Error:')} ${reason}`)
    process.exitCode = 2
    return undefined
  }

  const diagnosis = analyzeRequests(requests, options.slowMs !== undefined ? { slowMs: options.slowMs } : {})
  const violations = evaluateAssertions(requests, diagnosis, options)

  // Only surface findings relevant to CI gating (failures + secrets), not the full audit noise.
  const relevantFindings = diagnosis.findings.filter(
    (f) => f.kind === 'failure' || f.kind === 'auth' || f.kind === 'secret-in-body' || f.kind === 'slow',
  )
  printReport(diagnosis, violations, filePath, relevantFindings)

  process.exitCode = violations.length > 0 ? 1 : 0
  return { diagnosis, violations }
}
