#!/usr/bin/env node
// Compare each docs/src/content/docs/spec/*.md card's "Platform matrix" table
// against SPEC.md's §5 parity matrix — the single source of truth for
// cross-platform status. Exits non-zero (with actionable output) when a
// card's row for a platform disagrees with SPEC.md's row of the same name.
//
// A card row whose name doesn't match any SPEC §5 row (e.g. "Redaction",
// "Theming (token sync)" — capabilities SPEC §5 doesn't track as a distinct
// row) is reported as informational only, never a failure: there is nothing
// in SPEC.md to drift from.
//
//   node scripts/spec-drift-check.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specPath = join(repoRoot, 'SPEC.md')
const specDocsDir = join(repoRoot, 'docs/src/content/docs/spec')

const PLATFORMS = ['RN', 'iOS', 'Android', 'Web']
// DESIGN.md "No emojis" status marks: ● shipped, ◐ partial, ○ roadmap, — not
// offered, ⊘ out of scope.
const VALID_SYMBOLS = new Set(['●', '◐', '○', '—', '⊘'])

// Strip superscript footnote markers (¹²³⁴⁵⁶⁷⁸⁹⁰, any run of them) and any
// parenthetical suffix (e.g. "(core)", "(v3)"), then trim whitespace.
const SUPERSCRIPT_RE = /[¹²³⁰⁴-⁹]+/g
function stripFootnote(text) {
  return text
    .replace(SUPERSCRIPT_RE, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
}

/** Split a markdown table row `| a | b | c |` into trimmed cells, dropping empty leading/trailing splits. */
function splitRow(line) {
  const trimmed = line.trim()
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutEdges.split('|').map((c) => c.trim())
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

/**
 * Parse every markdown pipe-table found in `text` into
 * { header: string[], rows: string[][] }[]. Tables are contiguous runs of
 * lines starting with "|"; a table needs a header + a dash separator row to
 * count.
 */
function parseTables(text) {
  const lines = text.split('\n')
  const tables = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) {
      i++
      continue
    }
    const start = i
    while (i < lines.length && lines[i].trim().startsWith('|')) i++
    const block = lines.slice(start, i)
    if (block.length >= 2 && isSeparatorRow(splitRow(block[1]))) {
      const header = splitRow(block[0])
      const rows = block.slice(2).map(splitRow)
      tables.push({ header, rows })
    }
  }
  return tables
}

/** Extract the text of a `## <heading>` section (up to the next `## ` heading or EOF). */
function extractSection(text, headingRe) {
  const lines = text.split('\n')
  const startIdx = lines.findIndex((l) => headingRe.test(l))
  if (startIdx === -1) return null
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i
      break
    }
  }
  return lines.slice(startIdx, endIdx).join('\n')
}

// ── 1. Parse SPEC.md §5 parity matrix into { rowName: { RN, iOS, Android, Web } } ──

function parseSpecMatrix() {
  const specText = readFileSync(specPath, 'utf8')
  const section = extractSection(specText, /^##\s*5\.\s*Parity matrix/)
  if (!section) {
    throw new Error('Could not find "## 5. Parity matrix" section in SPEC.md')
  }
  const tables = parseTables(section)
  if (tables.length === 0) {
    throw new Error('Could not find a parity matrix table under SPEC.md §5')
  }
  const table = tables[0]
  const header = table.header.map(stripFootnote)
  const colIndex = {}
  for (const platform of PLATFORMS) {
    const idx = header.findIndex((h) => h === platform)
    if (idx === -1) throw new Error(`SPEC.md §5 table is missing a "${platform}" column`)
    colIndex[platform] = idx
  }

  const matrix = new Map()
  for (const row of table.rows) {
    if (row.every((c) => c === '')) continue
    const name = stripFootnote(row[0])
    if (!name) continue
    const cells = {}
    for (const platform of PLATFORMS) {
      const raw = row[colIndex[platform]] ?? ''
      cells[platform] = stripFootnote(raw)
    }
    matrix.set(name, cells)
  }
  return matrix
}

// ── 2. Parse each spec card's "## Platform matrix" table(s) ──

function parseCardMatrix(cardText) {
  const section = extractSection(cardText, /^##\s*Platform matrix/)
  if (!section) return null
  const tables = parseTables(section)
  const rows = new Map()
  for (const table of tables) {
    const header = table.header.map(stripFootnote)
    if (!header.some((h) => /capability/i.test(h))) continue
    const colIndex = {}
    let hasAllPlatforms = true
    for (const platform of PLATFORMS) {
      const idx = header.findIndex((h) => h === platform)
      if (idx === -1) hasAllPlatforms = false
      colIndex[platform] = idx
    }
    if (!hasAllPlatforms) continue
    for (const row of table.rows) {
      if (row.every((c) => c === '')) continue
      const name = stripFootnote(row[0])
      if (!name) continue
      const cells = {}
      for (const platform of PLATFORMS) {
        cells[platform] = stripFootnote(row[colIndex[platform]] ?? '')
      }
      rows.set(name, cells)
    }
  }
  return rows
}

function main() {
  const specMatrix = parseSpecMatrix()

  const cardFiles = readdirSync(specDocsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
  if (cardFiles.length === 0) {
    console.error(`No spec cards found in ${specDocsDir}`)
    process.exit(1)
  }

  const mismatches = []
  const unmatchedInfo = []
  let checkedRows = 0

  for (const file of cardFiles) {
    const fullPath = join(specDocsDir, file)
    const cardText = readFileSync(fullPath, 'utf8')
    const cardMatrix = parseCardMatrix(cardText)
    if (!cardMatrix || cardMatrix.size === 0) {
      mismatches.push({
        file,
        row: null,
        message: 'no "## Platform matrix" table found (or it is missing an RN/iOS/Android/Web column)',
      })
      continue
    }

    for (const [rowName, cardCells] of cardMatrix) {
      const specCells = specMatrix.get(rowName)
      if (!specCells) {
        unmatchedInfo.push({ file, row: rowName })
        continue
      }
      checkedRows++
      for (const platform of PLATFORMS) {
        const expected = specCells[platform]
        const actual = cardCells[platform]
        // Unrecognised symbols still get flagged even if they happen to
        // string-match — catches a typo'd cell that isn't a valid symbol at all.
        if (!VALID_SYMBOLS.has(actual)) {
          mismatches.push({
            file,
            row: rowName,
            platform,
            expected,
            actual,
            message: `not a recognised status symbol (expected one of ${[...VALID_SYMBOLS].join(' ')})`,
          })
          continue
        }
        if (expected !== actual) {
          mismatches.push({ file, row: rowName, platform, expected, actual })
        }
      }
    }
  }

  console.log(`Checked ${checkedRows} card row(s) against SPEC.md §5 across ${cardFiles.length} card(s).`)

  if (unmatchedInfo.length > 0) {
    console.log(`\n${unmatchedInfo.length} row(s) have no matching SPEC §5 row (informational, not a failure):`)
    for (const { file, row } of unmatchedInfo) {
      console.log(`  - ${file}: "${row}"`)
    }
  }

  if (mismatches.length > 0) {
    console.error(`\nDesign-drift: ${mismatches.length} platform-matrix mismatch(es) against SPEC.md §5:\n`)
    for (const m of mismatches) {
      if (m.row === null) {
        console.error(`  ${m.file}: ${m.message}`)
      } else if (m.expected === undefined) {
        console.error(`  ${m.file}: row "${m.row}" — ${m.message}`)
      } else {
        console.error(
          `  ${m.file}: row "${m.row}", platform ${m.platform} — SPEC.md §5 says "${m.expected}", card says "${m.actual}"`,
        )
      }
    }
    console.error(
      '\nFix: make the card cell match SPEC.md §5 exactly, or update SPEC.md §5 if the card reflects newly ' +
        'shipped/changed platform support (then update this card set to match).',
    )
    process.exit(1)
  }

  console.log('\nAll spec-card platform matrices match SPEC.md §5. No drift detected.')
}

main()
