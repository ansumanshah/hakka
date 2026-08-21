import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads a pinned control-channel wire fixture from the repo-shared
 * `fixtures/control/` directory — the same JSON the Swift and Kotlin
 * parser/encoder tests assert against, so the three runtimes cannot drift
 * apart on the `breakpoint.paused` / `breakpoint.resume` / `breakpoint.abort`
 * shapes. See `fixtures/control/README.md`.
 */
const CONTROL_FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'control',
)

export function readControlFixture(name: string): unknown {
  const raw = readFileSync(join(CONTROL_FIXTURES_DIR, name), 'utf-8')
  return JSON.parse(raw)
}
