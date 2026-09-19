#!/usr/bin/env node
// Enforce a 500-line cap on package UI source, excluding generated files.
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES_ROOT = join(repoRoot, 'packages')

const CAP = 500

// Exact repository path -> reason. Remove exceptions when their files shrink.
const ALLOWLIST = new Map([['packages/hakka-browser/src/ui/styles.ts', 'single CSS template by design']])

const isGenerated = (file) => basename(file).includes('.generated.')

const TS_EXT = /\.tsx?$/

async function* walk(dir, exts) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // no src/ui in this package — fine, just nothing to walk
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      yield* walk(join(dir, entry.name), exts)
    } else if (exts.test(entry.name)) {
      yield join(dir, entry.name)
    }
  }
}

function countLines(file) {
  const content = readFileSync(file, 'utf8')
  if (content === '') return 0
  const lines = content.split('\n')
  // Ignore the empty segment after a trailing newline.
  return content.endsWith('\n') ? lines.length - 1 : lines.length
}

const violations = []

for (const pkg of await readdir(PACKAGES_ROOT, { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue
  const uiDir = join(PACKAGES_ROOT, pkg.name, 'src/ui')
  for await (const file of walk(uiDir, TS_EXT)) {
    const relPath = relative(repoRoot, file)
    if (isGenerated(relPath) || ALLOWLIST.has(relPath)) continue
    const lines = countLines(file)
    if (lines > CAP) violations.push({ file: relPath, lines })
  }
}

if (violations.length === 0) {
  console.log(`file-size-check: no UI file exceeds the ${CAP}-line cap`)
  process.exit(0)
}

violations.sort((a, b) => b.lines - a.lines)
console.error(`file-size-check: ${violations.length} file(s) over the ${CAP}-line cap.\n`)
for (const v of violations) {
  console.error(`  ${v.file} (${v.lines} lines)`)
}
console.error(
  '\nSplit the file, or if it is a deliberate exception, add it to the ALLOWLIST' +
    '\nin scripts/file-size-check.mjs with a reason.',
)
process.exit(1)
