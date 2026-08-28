/**
 * `hakka ci-baseline record|check <capture.hakka> <baseline.txt>` — the CLI
 * entry point a CI job calls. Wraps `hakka-node/ci`'s pure normalize/diff/
 * exfiltration functions with file I/O, plain-text reporting, and exit codes
 * — the same split `assert.ts`/`diagnose.ts` already use.
 *
 * `record` writes/overwrites the committed baseline from a capture — run
 * this locally when a change to network calls is intentional, then commit
 * the resulting diff for review (same workflow as updating a snapshot test).
 *
 * `check` is the actual CI gate: normalizes the fresh capture, diffs it
 * against the committed baseline, runs the exfiltration check, prints a
 * plain-text report, and sets a non-zero exit code on any FAIL finding.
 *
 * Exit codes (both subcommands):
 *   0 — pass (record: always; check: no FAIL finding)
 *   1 — fail (check: at least one FAIL finding — drift or exfiltration)
 *   2 — bad input (missing args, unreadable/unparseable capture or baseline)
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { deserializeSession, type NetworkRequest } from 'hakka-core'
import {
  diffBaseline,
  findExfiltrationFindings,
  formatDriftReport,
  formatExfiltrationReport,
  normalizeRequestsForBaseline,
  parseBaseline,
  serializeBaseline,
  type DriftFinding,
  type ExfiltrationFinding,
} from 'hakka-node/ci'

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}
const log = (s = '') => process.stdout.write(s + '\n')
const logErr = (s = '') => process.stderr.write(s + '\n')

/** Load a `.hakka` session written by `hakka-node/ci`'s `startCiCapture`. Throws with a clear message on failure — deliberately narrower than `diagnose.ts`'s loader (no `.har` support): a CI capture is always a `.hakka` session, never a browser HAR export. */
export function loadCiCapture(path: string): NetworkRequest[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`could not read ${path}: ${reason}`)
  }
  return deserializeSession(raw).requests
}

export interface CiBaselineUsageError {
  message: string
}

function usage(): void {
  logErr(`Usage: ${c.cyan('hakka ci-baseline record <capture.hakka> <baseline.txt>')}`)
  logErr(`       ${c.cyan('hakka ci-baseline check <capture.hakka> <baseline.txt>')} ${c.dim('[--allow-host <host>]')}`)
}

/** `hakka ci-baseline record` — normalize a capture and (over)write the baseline file. Sets process.exitCode (0 pass / 2 bad input) — does not call process.exit. */
export function recordCommand(capturePath: string | undefined, baselinePath: string | undefined): void {
  if (!capturePath || !baselinePath) {
    usage()
    process.exitCode = 2
    return
  }

  let requests: NetworkRequest[]
  try {
    requests = loadCiCapture(capturePath)
  } catch (e: unknown) {
    logErr(`${c.red('Error:')} ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 2
    return
  }

  const endpoints = normalizeRequestsForBaseline(requests)
  writeFileSync(baselinePath, serializeBaseline(endpoints))
  process.exitCode = 0

  log()
  log(`${c.bold('Hakka CI baseline recorded')} ${c.dim(baselinePath)}`)
  log(
    `  ${c.green('•')} ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} from ${requests.length} captured request${requests.length === 1 ? '' : 's'}`,
  )
  log()
  log(`  Review the diff and commit ${c.cyan(baselinePath)} — that review IS the contract check.`)
  log()
}

export interface CiCheckResult {
  driftFindings: DriftFinding[]
  exfiltrationFindings: ExfiltrationFinding[]
  pass: boolean
}

function printCheckReport(capturePath: string, baselinePath: string, result: CiCheckResult): void {
  log()
  log(`${c.bold('Hakka CI check')} ${c.dim(`${capturePath} vs ${baselinePath}`)}`)
  log()
  log(c.bold('Contract drift'))
  log(formatDriftReport(result.driftFindings))
  log()
  log(c.bold('Exfiltration risk'))
  log(formatExfiltrationReport(result.exfiltrationFindings))
  log()

  if (result.pass) {
    log(`${c.green('PASS')} — no blocking drift.`)
  } else {
    const failCount =
      result.driftFindings.filter((f) => f.severity === 'fail').length + result.exfiltrationFindings.length
    log(`${c.red('FAIL')} — ${failCount} finding${failCount === 1 ? '' : 's'} require attention.`)
    log(`  If this drift is intentional: re-run ${c.cyan('hakka ci-baseline record')} and commit the diff.`)
  }
  log()
}

/** `hakka ci-baseline check` — diff a fresh capture against the committed baseline plus the exfiltration scan. Sets process.exitCode (0 pass / 1 fail / 2 bad input) — does not call process.exit. */
export function checkCommand(
  capturePath: string | undefined,
  baselinePath: string | undefined,
  options: { allowHosts?: string[] } = {},
): CiCheckResult | undefined {
  if (!capturePath || !baselinePath) {
    usage()
    process.exitCode = 2
    return undefined
  }

  let requests: NetworkRequest[]
  try {
    requests = loadCiCapture(capturePath)
  } catch (e: unknown) {
    logErr(`${c.red('Error:')} ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 2
    return undefined
  }

  let baselineText: string
  try {
    baselineText = readFileSync(baselinePath, 'utf8')
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    logErr(
      `${c.red('Error:')} could not read baseline ${baselinePath}: ${reason}\n` +
        `  No baseline yet? Run ${c.cyan(`hakka ci-baseline record ${capturePath} ${baselinePath}`)} once and commit it.`,
    )
    process.exitCode = 2
    return undefined
  }

  let baseline: ReturnType<typeof parseBaseline>
  try {
    baseline = parseBaseline(baselineText)
  } catch (e: unknown) {
    logErr(`${c.red('Error:')} ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 2
    return undefined
  }

  const current = normalizeRequestsForBaseline(requests)
  const driftFindings = diffBaseline(baseline.endpoints, current)

  // The exfiltration check's allowlist is the baseline's own known hosts,
  // widened by any explicit --allow-host (e.g. a host the app legitimately
  // talks to that just hasn't shown up in a baseline yet).
  const knownHosts = new Set([...baseline.endpoints.map((e) => e.host), ...(options.allowHosts ?? [])])
  const exfiltrationFindings = findExfiltrationFindings(requests, { knownHosts })

  const driftFails = driftFindings.some((f) => f.severity === 'fail')
  const pass = !driftFails && exfiltrationFindings.length === 0

  const result: CiCheckResult = { driftFindings, exfiltrationFindings, pass }
  printCheckReport(capturePath, baselinePath, result)
  process.exitCode = pass ? 0 : 1
  return result
}

/** Parse `hakka ci-baseline <record|check> <capture> <baseline> [--allow-host <host>]` argv (post-subcommand args). */
export function parseCiBaselineArgs(args: string[]): {
  mode: 'record' | 'check' | undefined
  capturePath: string | undefined
  baselinePath: string | undefined
  allowHosts: string[]
} {
  const mode = args[0] === 'record' || args[0] === 'check' ? args[0] : undefined
  const allowHosts: string[] = []
  const positional: string[] = []
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a === '--allow-host') {
      if (args[i + 1]) allowHosts.push(args[i + 1]!)
      i++ // skip its value operand too
    } else if (a !== undefined && !a.startsWith('--')) {
      positional.push(a)
    }
  }
  return { mode, capturePath: positional[0], baselinePath: positional[1], allowHosts }
}

/** `hakka ci-baseline` entrypoint dispatch. */
export function ciBaselineCommand(args: string[]): void {
  const { mode, capturePath, baselinePath, allowHosts } = parseCiBaselineArgs(args)
  if (mode === 'record') {
    recordCommand(capturePath, baselinePath)
  } else if (mode === 'check') {
    checkCommand(capturePath, baselinePath, { allowHosts })
  } else {
    usage()
    process.exitCode = 2
  }
}
