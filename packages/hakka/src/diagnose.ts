/**
 * `hakka diagnose <file>` — load a saved `.hakka` session or a `.har` capture
 * from disk, run the shared `analyzeRequests` engine (same one that backs the
 * MCP `diagnose` tool), and pretty-print the result to the terminal.
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

import { analyzeRequests, deserializeSession, type NetworkRequest, type RequestDiagnosis } from 'hakka-core'

import { harToRequests, isHarPayload } from './harLoad'

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

const SEVERITY_BADGE: Record<RequestDiagnosis['findings'][number]['severity'], string> = {
  error: c.red('error'),
  warning: c.yellow('warn '),
  info: c.dim('info '),
}

/** Load requests from a `.hakka` session file or a `.har` capture. Throws with a clear message on failure. */
export function loadRequestsFromFile(path: string): NetworkRequest[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`could not read ${path}: ${reason}`)
  }

  const ext = extname(path).toLowerCase()

  // .hakka first — deserializeSession is authoritative and gives the clearest error on malformed files.
  if (ext === '.hakka') {
    return deserializeSession(raw).requests
  }

  if (ext === '.har') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e)
      throw new Error(`${path} is not valid JSON: ${reason}`)
    }
    if (!isHarPayload(parsed)) {
      throw new Error(`${path} does not look like a HAR file (expected a "log.entries" array)`)
    }
    return harToRequests(parsed)
  }

  // Unknown extension — sniff the content instead of refusing outright.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`${path}: not valid JSON (expected a .hakka session or .har capture) — ${reason}`)
  }
  if (isHarPayload(parsed)) return harToRequests(parsed)
  return deserializeSession(raw).requests
}

function formatFinding(f: RequestDiagnosis['findings'][number]): string {
  const badge = SEVERITY_BADGE[f.severity]
  return `  ${badge}  ${f.message}`
}

/** Pretty-print a RequestDiagnosis to stdout: summary, ranked findings, slowest. */
function printDiagnosis(diagnosis: RequestDiagnosis, sourcePath: string): void {
  log()
  log(`${c.bold('Hakka diagnose')} ${c.dim(sourcePath)}`)
  log()
  log(c.bold('Summary'))
  log(`  ${diagnosis.summary}`)
  log()

  log(c.bold(`Findings ${c.dim(`(${diagnosis.findings.length})`)}`))
  if (diagnosis.findings.length === 0) {
    log(`  ${c.green('OK')} no findings — traffic looks healthy.`)
  } else {
    for (const f of diagnosis.findings) log(formatFinding(f))
  }
  log()

  log(c.bold(`Slowest requests ${c.dim(`(top ${diagnosis.slowest.length})`)}`))
  if (diagnosis.slowest.length === 0) {
    log(`  ${c.dim('no timed requests')}`)
  } else {
    for (const r of diagnosis.slowest) {
      log(`  ${c.cyan(`${r.durationMs}ms`.padStart(8))}  ${r.url}`)
    }
  }
  log()
}

export function diagnose(filePath: string | undefined, options: { slowMs?: number } = {}): void {
  if (!filePath) {
    logErr(`Usage: ${c.cyan('hakka diagnose <file.hakka|file.har>')}`)
    process.exitCode = 1
    return
  }

  let requests: NetworkRequest[]
  try {
    requests = loadRequestsFromFile(filePath)
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e)
    logErr(`${c.red('Error:')} ${reason}`)
    process.exitCode = 1
    return
  }

  const diagnosis = analyzeRequests(requests, options.slowMs !== undefined ? { slowMs: options.slowMs } : {})
  printDiagnosis(diagnosis, filePath)

  if (diagnosis.failed > 0) process.exitCode = 1
}
