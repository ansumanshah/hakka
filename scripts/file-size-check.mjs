#!/usr/bin/env node
/**
 * Fails when a UI/component source file blows past a 500-line cap.
 *
 * Scope:
 *   packages/*\/src/ui/**\/*.{ts,tsx}         every package's UI source tree
 *
 * The ALLOWLIST is meant to shrink, not grow. Every `TODO(#51)` entry is a
 * file already over the cap and already queued for splitting under that
 * issue. When a split lands, delete its line here — don't leave a green
 * entry behind. A new entry without a TODO needs a real reason (generated
 * code, a single deliberate template).
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES_ROOT = join(repoRoot, 'packages')

const CAP = 500

// Relative-to-repoRoot path (forward slashes) -> reason. Exact match only —
// this is a list of specific files, not a pattern.
const ALLOWLIST = [['packages/hakka-browser/src/ui/styles.ts', 'single CSS template by design']]
const ALLOWLISTED = new Map(ALLOWLIST)

// Generated files carry their line count by construction, never by hand — a
// cap polices nothing there. Matched by filename pattern rather than listed
// individually, so a new generated file never needs its own allowlist entry.
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
  // A trailing newline (the normal case) leaves one empty split segment after
  // the last line — drop it so this matches `wc -l`, not `wc -l` + 1.
  return content.endsWith('\n') ? lines.length - 1 : lines.length
}

const seen = new Set()
const files = []

for (const pkg of await readdir(PACKAGES_ROOT, { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue
  const uiDir = join(PACKAGES_ROOT, pkg.name, 'src/ui')
  for await (const file of walk(uiDir, TS_EXT)) {
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
  }
}

const violations = []

for (const file of files) {
  const relPath = relative(repoRoot, file)
  if (isGenerated(relPath)) continue
  if (ALLOWLISTED.has(relPath)) continue
  const lines = countLines(file)
  if (lines > CAP) violations.push({ file: relPath, lines })
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
    '\nin scripts/file-size-check.mjs with a reason (a TODO(#51) if it is queued for splitting).',
)
process.exit(1)
