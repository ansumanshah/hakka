import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runCollection } from '../runCommand.js'
import type { RunReport } from '../runCommand.js'
import { writeSnapshot } from './sync.js'

export async function runTeamSnapshot(
  files: Record<string, string>,
  secrets: Record<string, string>,
  deadlineMs: number,
  signal: AbortSignal,
): Promise<RunReport> {
  const directory = await mkdtemp(join(tmpdir(), 'hakka-team-run-'))
  try {
    signal.throwIfAborted()
    await writeSnapshot(directory, files)
    signal.throwIfAborted()
    return await runCollection(directory, {
      environment: secrets,
      timeoutMs: deadlineMs,
      signal,
      allowScripts: false,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
