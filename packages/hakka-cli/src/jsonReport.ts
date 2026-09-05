import { createHash } from 'node:crypto'

import { scrubUrlForShare, type DiagnosisFinding, type NetworkRequest, type RequestDiagnosis } from 'hakka-core'
import type { DriftFinding, ExfiltrationFinding } from 'hakka-node/ci'

import type { AssertOptions, AssertViolation } from './assert'

export type JsonReportCommand = 'assert' | 'ci-baseline check'

export interface JsonReportFinding {
  source: 'diagnosis' | 'drift' | 'exfiltration'
  kind: string
  severity: 'error' | 'warning' | 'info' | 'fail' | 'warn'
  reference?: string
  url?: string
  reason?: 'query-param' | 'request-body-field' | 'jwt' | 'authorization-header'
}

export interface JsonReportViolation {
  rule: string
  actual?: number
  limit?: number
  affected?: number
  reference?: string
  url?: string
}

export interface JsonCheckReport {
  schemaVersion: 1
  command: JsonReportCommand
  pass: boolean
  exitCode: 0 | 1 | 2
  violations: JsonReportViolation[]
  findings: JsonReportFinding[]
  redaction: { applied: true }
  error?: { code: string }
}

export function writeJsonReport(report: JsonCheckReport): void {
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

export function inputErrorReport(command: JsonReportCommand, code: string): JsonCheckReport {
  return {
    schemaVersion: 1,
    command,
    pass: false,
    exitCode: 2,
    violations: [],
    findings: [],
    redaction: { applied: true },
    error: { code },
  }
}

function referenceFor(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

/** Keep the origin useful while removing credentials, query values, and user-controlled path text. */
function projectUrl(url: string): { url?: string; reference: string } {
  const reference = referenceFor(url)
  const scrubbed = scrubUrlForShare(url).url
  try {
    const parsed = new URL(scrubbed)
    parsed.pathname = parsed.pathname === '/' ? '/' : '/[REDACTED]'
    parsed.hash = ''
    for (const key of parsed.searchParams.keys()) parsed.searchParams.set(key, '[REDACTED]')
    return { url: parsed.toString(), reference }
  } catch {
    return { reference }
  }
}

export function projectDiagnosisFindings(findings: readonly DiagnosisFinding[]): JsonReportFinding[] {
  return findings.map((finding) => ({
    source: 'diagnosis',
    kind: finding.kind,
    severity: finding.severity,
    ...(finding.url ? projectUrl(finding.url) : {}),
  }))
}

export function projectAssertViolations(
  violations: readonly AssertViolation[],
  requests: readonly NetworkRequest[],
  diagnosis: RequestDiagnosis,
  options: AssertOptions,
): JsonReportViolation[] {
  return violations.map((violation) => {
    switch (violation.rule) {
      case 'max-failures':
        return { rule: violation.rule, actual: diagnosis.failed, limit: options.maxFailures ?? 0 }
      case 'max-duration-ms': {
        const slow = requests
          .filter((request) => request.duration != null && request.duration > (options.maxDurationMs ?? Infinity))
          .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
        const worst = slow[0]
        return {
          rule: violation.rule,
          affected: slow.length,
          actual: worst?.duration ?? 0,
          limit: options.maxDurationMs,
          ...(worst ? projectUrl(worst.url) : {}),
        }
      }
      case 'fail-on-secrets':
        return {
          rule: violation.rule,
          affected: diagnosis.findings.filter((finding) => finding.kind === 'secret-in-body').length,
        }
      case 'budget-p95-ms': {
        const durations = requests
          .flatMap((request) => (request.duration == null ? [] : [request.duration]))
          .sort((a, b) => a - b)
        const index = Math.max(0, Math.ceil(0.95 * durations.length) - 1)
        return { rule: violation.rule, actual: durations[index], limit: options.budgetP95Ms }
      }
      default:
        return { rule: violation.rule }
    }
  })
}

function projectExfiltrationReason(reason: string): JsonReportFinding['reason'] {
  if (reason.startsWith('query param')) return 'query-param'
  if (reason.startsWith('request body field')) return 'request-body-field'
  if (reason.startsWith('JWT')) return 'jwt'
  return 'authorization-header'
}

export function projectBaselineFindings(
  driftFindings: readonly DriftFinding[],
  exfiltrationFindings: readonly ExfiltrationFinding[],
): JsonReportFinding[] {
  return [
    ...driftFindings.map((finding): JsonReportFinding => ({
      source: 'drift',
      kind: finding.kind,
      severity: finding.severity,
      reference: referenceFor(finding.subject),
    })),
    ...exfiltrationFindings.map((finding): JsonReportFinding => ({
      source: 'exfiltration',
      kind: 'new-host-credential',
      severity: finding.severity,
      reason: projectExfiltrationReason(finding.reason),
      ...projectUrl(finding.url),
    })),
  ]
}
