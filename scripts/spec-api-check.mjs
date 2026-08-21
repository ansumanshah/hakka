#!/usr/bin/env node
/**
 * Checks that every symbol a spec card says you can import is actually
 * exported by the package it names.
 *
 * `spec-drift-check.mjs` compares two markdown files against each other, so it
 * cannot catch a card that documents an API the code doesn't have. That is a
 * worse failure than a stale matrix cell: a reader copies the import, and it
 * throws. Auditing the redaction card by hand turned up two claims that were
 * simply untrue, which is what prompted this.
 *
 * Scope: the `import { … } from '<pkg>'` blocks inside spec cards. Type-only
 * imports count — they are equally copy-pasteable.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = join(root, 'docs/src/content/docs/spec')

/**
 * Import specifier → the entry file whose exports it resolves to. Subpaths are
 * listed explicitly: `hakka-react-native/ui` and `/monitors` are separate
 * entries, and conflating them with the root is exactly the mistake this
 * catches — two spec cards documented `HakkaInspector` and the storage
 * monitors as root imports when they ship on subpaths.
 */
const packageEntries = {
  'hakka-core': 'packages/hakka-core/src/index.ts',
  'hakka-browser': 'packages/hakka-browser/src/index.ts',
  'hakka-node': 'packages/hakka-node/src/index.ts',
  'hakka-node/prod': 'packages/hakka-node/src/prod.ts',
  'hakka-node/ci': 'packages/hakka-node/src/ci/index.ts',
  'hakka-bridge': 'packages/hakka-bridge/src/index.ts',
  'hakka-react-native': 'packages/hakka-react-native/src/index.ts',
  'hakka-react-native/ui': 'packages/hakka-react-native/src/ui.ts',
  'hakka-react-native/monitors': 'packages/hakka-react-native/src/monitors.ts',
}

/**
 * Every name a package's entry point re-exports, followed one level through
 * `export … from './x'` so barrel files resolve. Deliberately not a full
 * module graph: one level covers how these packages are laid out, and a
 * checker nobody can debug is worse than a shallow one.
 */
function exportedNames(pkg) {
  const entry = join(root, packageEntries[pkg])
  if (!existsSync(entry)) return null

  const names = new Set()
  const visit = (file, depth) => {
    if (depth > 2 || !existsSync(file)) return
    const text = readFileSync(file, 'utf8')

    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s+from\s+'([^']+)')?/g)) {
      for (const raw of match[1].split(',')) {
        const name = raw
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim()
        if (name) names.add(name.replace(/^type\s+/, ''))
      }
    }
    // `export const foo`, `export function foo`, `export class Foo`, …
    for (const match of text.matchAll(
      /export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+(\w+)/g,
    )) {
      names.add(match[1])
    }
    // `export * from './x'` — follow it, since the names live there.
    for (const match of text.matchAll(/export\s+\*\s+from\s+'(\.[^']+)'/g)) {
      visit(resolveRelative(file, match[1]), depth + 1)
    }
  }

  visit(entry, 0)
  return names
}

function resolveRelative(fromFile, spec) {
  const base = join(dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return base
}

const exportCache = new Map()
function exportsFor(pkg) {
  if (!exportCache.has(pkg)) exportCache.set(pkg, exportedNames(pkg))
  return exportCache.get(pkg)
}

const problems = []
let checkedSymbols = 0

for (const file of readdirSync(specDir).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(join(specDir, file), 'utf8')

  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
    const pkg = match[2]
    if (!(pkg in packageEntries)) continue

    const available = exportsFor(pkg)
    if (!available) {
      problems.push(`${file}: cannot resolve exports for '${pkg}'`)
      continue
    }

    // Import lists carry inline comments (`HAKKA_TRACE_HEADER, // 'x-hakka-trace'`),
    // which would otherwise be read as part of the next symbol's name.
    const names = match[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const raw of names.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim()
      if (!name) continue
      checkedSymbols += 1
      if (!available.has(name)) {
        problems.push(`${file}: '${name}' is documented as an export of '${pkg}' but is not exported`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error('spec-api-check: documented APIs that do not exist\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(`\n${problems.length} problem(s) across ${checkedSymbols} documented symbols.`)
  process.exit(1)
}

console.log(`spec-api-check: all ${checkedSymbols} documented symbols are exported.`)
