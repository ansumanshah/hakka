import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads a pinned SSE wire fixture from the repo-shared `fixtures/sse/`
 * directory — the same transcripts the Swift presenter asserts against, so
 * the two surfaces cannot drift apart.
 */
const SSE_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'sse',
)

export function readSseFixture(name: string): string {
  return readFileSync(join(SSE_FIXTURES_DIR, name), 'utf-8')
}
