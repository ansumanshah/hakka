/**
 * `hakka-node/ci` recorder — the piece a test suite's setup/teardown calls
 * directly. Wraps `startCapture`, collects every request the suite makes
 * in-memory, and on `.stop()` writes them out as a plain `.hakka` session
 * file (the same format `hakka diagnose`/`hakka assert` already read) so the
 * `hakka ci-baseline record|check` CLI command can pick it up — no new file
 * format for raw captures, only the committed baseline (`baseline.ts`) is new.
 *
 * The written session is a build artifact (typically `.gitignore`d,
 * regenerated every CI run), NOT the thing reviewers see — the committed
 * baseline is. Keeping this raw file around at all is purely for local
 * debugging (`hakka diagnose ci-capture.hakka` to see exactly what was
 * captured before it got normalized away).
 *
 * The file IS a share surface, though — a CI run routinely uploads it as a
 * build artifact for post-mortem debugging (a failed `hakka ci-baseline
 * check` is exactly when someone reaches for it), which means it leaves the
 * machine same as any other export. So the written file goes through
 * `hakka-core`'s `scrubRequestsForShare` (the same share-time scrubbing pass
 * used everywhere else an artifact leaves the machine) before it touches
 * disk — the in-memory `requests` returned to the caller are NOT scrubbed,
 * since normalize/diff run in-process and never leave it, and a developer
 * inspecting `capture.requests` locally is exactly the audience share-time
 * scrubbing is not for (see `shareScrub.ts`'s module doc on that distinction).
 *
 *   import { startCiCapture } from 'hakka-node/ci'
 *
 *   const capture = startCiCapture()
 *   // ...run the test suite, exercising real network calls...
 *   capture.stop('ci-capture.hakka')
 */
import { writeFileSync } from 'node:fs'

import { scrubRequestsForShare, serializeSession, type NetworkRequest, type ShareScrubSummary } from 'hakka-core'

import { startCapture, type HakkaNodeCapture, type HakkaNodeOptions } from '../serverCapture'

export interface CiCaptureHandle {
  /** Requests captured so far (live reference — grows until `stop()`), UNscrubbed — see module doc. */
  readonly requests: NetworkRequest[]
  /**
   * Stop capturing. When `outFile` is given, writes the collected requests
   * to it as a `.hakka` session, share-scrubbed first (see module doc).
   * Always returns the collected (unscrubbed) requests either way, so a
   * caller that wants to skip the file and normalize/diff in-process can do
   * that instead.
   */
  stop(outFile?: string): NetworkRequest[]
}

/**
 * Start a CI capture. Deliberately does not start the bridge/overlay (no
 * human is watching a CI run) and forces capture on regardless of
 * `NODE_ENV` (CI is rarely `NODE_ENV=development`) — both overridable via
 * `options` since a caller might want to record in a dev-like harness too.
 */
export function startCiCapture(options: HakkaNodeOptions = {}): CiCaptureHandle {
  const requests: NetworkRequest[] = []

  const capture: HakkaNodeCapture = startCapture({
    runtime: 'server',
    bridge: false,
    embedBridge: false,
    force: true,
    ...options,
    sink: (req) => {
      requests.push(req)
      options.sink?.(req)
    },
  })

  return {
    requests,
    stop(outFile?: string) {
      capture.stop()
      if (outFile) {
        const { requests: scrubbed, removed }: { requests: NetworkRequest[]; removed: ShareScrubSummary['removed'] } =
          scrubRequestsForShare(requests)
        writeFileSync(
          outFile,
          serializeSession(scrubbed, { source: 'hakka-node/ci', shareScrub: { applied: true, removed } }),
        )
      }
      return requests
    },
  }
}
