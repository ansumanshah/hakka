import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const fixtureRoot = mkdtempSync(join(tmpdir(), 'hakka-spec-api-'))

try {
  const script = join(fixtureRoot, 'scripts/spec-api-check.mjs')
  mkdirSync(dirname(script), { recursive: true })
  copyFileSync(new URL('./spec-api-check.mjs', import.meta.url), script)
  const entry = join(fixtureRoot, 'packages/hakka-core/src/index.ts')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, 'export const capture = () => {}\n')
  const card = join(fixtureRoot, 'docs/src/content/docs/spec/capture.md')
  mkdirSync(dirname(card), { recursive: true })

  for (const { source, status, diagnostic } of [
    { source: "import { capture } from 'hakka-core'", status: 0 },
    { source: "import { missing } from 'hakka-core'", status: 1, diagnostic: 'is not exported' },
    { source: "import { capture } from 'hakka-core/missing'", status: 1, diagnostic: 'no source entry' },
    { source: "import { capture } from 'hakka'", status: 1, diagnostic: 'no source entry' },
    { source: "import { unrelated } from 'external-library'", status: 0 },
  ]) {
    writeFileSync(card, `\`\`\`ts\n${source}\n\`\`\`\n`)
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 })
    const output = `${result.stdout}${result.stderr}`
    assert.equal(result.status, status, `${source}\n${output}`)
    if (diagnostic) assert.ok(output.includes(diagnostic), output)
  }
  console.log('Spec API fixtures passed: valid, missing, unmapped and external imports')
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
