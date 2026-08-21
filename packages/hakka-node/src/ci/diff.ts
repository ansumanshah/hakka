/**
 * Baseline drift — compare a baseline (committed, "what we expect to call")
 * against a fresh normalized capture ("what we actually called"), and decide
 * what counts as drift and whether it fails the build or only warns.
 *
 * Each category below is a deliberate design decision, not an accident of
 * implementation — the reasoning is in the comment next to where it's
 * produced. Two failure classes exist:
 *
 *   FAIL — the build must stop. Reserved for changes that are either a real
 *   contract break (an endpoint's response shape/status changed under
 *   callers that depend on it) or a security signal (a new field being sent,
 *   or a wholly new host being contacted — see requirement #4 in the repo
 *   prompt, the strongest single reason to adopt this feature).
 *
 *   WARN — worth a human's attention, printed in the report, but does not
 *   block the build. Reserved for changes that are common side effects of
 *   unrelated work (a dependency bump adding a header, a code path that
 *   stopped firing because of an unrelated branch) and would otherwise get
 *   this whole check disabled by a frustrated team within a week.
 */
import type { NormalizedEndpoint } from './normalize'

export type DriftSeverity = 'fail' | 'warn'

export type DriftKind =
  | 'new-endpoint'
  | 'removed-endpoint'
  | 'status-changed'
  | 'body-shape-changed'
  | 'new-header'
  | 'new-host'

export interface DriftFinding {
  kind: DriftKind
  severity: DriftSeverity
  /** The endpoint key this finding is about (`METHOD host path`), or the bare host for `new-host`. */
  subject: string
  message: string
}

/** Everything a host called by name matched against — used to catch `new-host` before per-endpoint diffing, since a wholly new host is worth flagging even if none of its individual endpoints look risky yet. */
function hostsOf(endpoints: readonly NormalizedEndpoint[]): Set<string> {
  return new Set(endpoints.map((e) => e.host))
}

/**
 * Compare a baseline against a fresh capture and return every drift finding.
 * Pure — no I/O, no process.exit — so it's directly unit-testable and the
 * CLI layer owns reporting/exit-code decisions.
 */
export function diffBaseline(
  baseline: readonly NormalizedEndpoint[],
  current: readonly NormalizedEndpoint[],
): DriftFinding[] {
  const findings: DriftFinding[] = []

  const baselineByKey = new Map(baseline.map((e) => [e.key, e]))
  const currentByKey = new Map(current.map((e) => [e.key, e]))

  // New host contacted at all, anywhere in the run — checked before the
  // per-endpoint loop below so it's reported once per host, not once per
  // endpoint on that host.
  const baselineHosts = hostsOf(baseline)
  for (const host of hostsOf(current)) {
    if (!baselineHosts.has(host)) {
      findings.push({
        kind: 'new-host',
        severity: 'fail',
        subject: host,
        // FAIL: a call to a host never approved for this run is the single
        // strongest signal of an SDK/dependency exfiltrating data, or a
        // supply-chain compromise. See exfiltration.ts for the companion
        // credential-shaped-field check against this same signal.
        message: `new host contacted: ${host} (not present in the baseline)`,
      })
    }
  }

  for (const [key, cur] of currentByKey) {
    const base = baselineByKey.get(key)
    if (!base) {
      findings.push({
        kind: 'new-endpoint',
        severity: 'fail',
        subject: key,
        // FAIL: same reasoning as a snapshot test — a new call is very
        // likely an intentional feature, but it must be captured in the
        // baseline deliberately (re-record + review the diff) rather than
        // silently start passing. A silently-accepted new endpoint is
        // exactly the shape a data-exfiltration regression would take.
        message: `new endpoint called: ${key}`,
      })
      continue
    }

    const newStatuses = cur.statuses.filter((s) => !base.statuses.includes(s))
    if (newStatuses.length > 0) {
      findings.push({
        kind: 'status-changed',
        severity: 'fail',
        subject: key,
        // FAIL: the most direct correctness signal available — an endpoint
        // that used to only 200 now also 500s (or previously errored and
        // now silently succeeds) is a real behavior change under test.
        message: `${key}: new status observed ${JSON.stringify(newStatuses)} (baseline: ${JSON.stringify(base.statuses)})`,
      })
    }

    const newShapes = cur.requestBodyShapes.filter((s) => !base.requestBodyShapes.includes(s))
    if (newShapes.length > 0) {
      findings.push({
        kind: 'body-shape-changed',
        severity: 'fail',
        subject: key,
        // FAIL: requirement #4 in the repo prompt, verbatim — "fail the
        // build when the app starts sending a field it never sent before."
        // Body shape only compares key names + JSON types (see normalize.ts),
        // so this never fires on a changed VALUE, only a changed SHAPE.
        message: `${key}: new request body shape\n      new: ${newShapes.join('\n           ')}\n      baseline: ${base.requestBodyShapes.join('\n                ') || '(no body previously observed)'}`,
      })
    }

    const newHeaders = cur.requestHeaderNames.filter((h) => !base.requestHeaderNames.includes(h))
    if (newHeaders.length > 0) {
      findings.push({
        kind: 'new-header',
        severity: 'warn',
        subject: key,
        // WARN: header names churn on ordinary dependency bumps (a new
        // debug/correlation header) far more often than they signal
        // anything meaningful, and header VALUES are never compared (see
        // normalize.ts) so this can't itself catch a leaked credential —
        // that's exfiltration.ts's job, which DOES look at values.
        message: `${key}: new request header(s) ${JSON.stringify(newHeaders)}`,
      })
    }
  }

  for (const [key] of baselineByKey) {
    if (!currentByKey.has(key)) {
      findings.push({
        kind: 'removed-endpoint',
        severity: 'warn',
        subject: key,
        // WARN: an endpoint dropping out is rarely itself a risk (it's
        // reduced exposure, not increased) and is often incidental to
        // unrelated test changes (a conditional code path, a feature flag).
        // Blocking the build on "you stopped calling something" is exactly
        // the kind of noise that gets a check like this disabled.
        message: `endpoint no longer called: ${key}`,
      })
    }
  }

  return findings
}

/** Render findings as plain text for CI log output — no ANSI colour, one finding per block, grouped by severity so FAIL items are never buried under WARN noise. */
export function formatDriftReport(findings: readonly DriftFinding[]): string {
  if (findings.length === 0) return 'No drift detected — capture matches the baseline.'

  const fails = findings.filter((f) => f.severity === 'fail')
  const warns = findings.filter((f) => f.severity === 'warn')
  const lines: string[] = []

  if (fails.length > 0) {
    lines.push(`FAIL (${fails.length}):`)
    for (const f of fails) lines.push(`  [${f.kind}] ${f.message}`)
  }
  if (warns.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`WARN (${warns.length}):`)
    for (const f of warns) lines.push(`  [${f.kind}] ${f.message}`)
  }

  return lines.join('\n')
}
