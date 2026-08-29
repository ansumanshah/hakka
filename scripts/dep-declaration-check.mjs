#!/usr/bin/env node
/**
 * Fails if a publishable package's PUBLISHED type declarations import another
 * workspace package that the package does not actually declare as a dependency.
 *
 * Why this exists: that exact defect has now shipped twice.
 *
 *   - `hakka-browser`'s `dist/types/index.d.ts` re-exported from `hakka-core`
 *     while `hakka-core` sat in devDependencies.
 *   - `hakka-bridge`'s `dist/index.d.mts` did the same, and survived a full
 *     adversarial audit pass that only checked hakka-browser.
 *
 * Both are invisible to every other gate in this repo, and that is the point:
 *   - the runtime bundle is fine, because these are type-only imports that are
 *     erased at build time, so no smoke check importing the package can fail;
 *   - `npm pack --dry-run` only proves the file list, not that the files resolve;
 *   - `smoke-tarball-install.mjs` installs all seven tarballs into ONE consumer
 *     project, so a missing dependency is masked by a sibling that declares it;
 *   - typecheck inside this repo passes because the workspace resolves
 *     everything from source regardless of what package.json claims.
 *
 * The failure only appears for someone who installs a single package on its own
 * and runs `tsc`, which is precisely what the packages' own READMEs document.
 * Reproduced before the fix as:
 *   node_modules/hakka-bridge/dist/index.d.mts(2,74): error TS2307:
 *   Cannot find module 'hakka-core' or its corresponding type declarations.
 *
 * Scope, deliberately narrow: only imports of OTHER workspace packages
 * (`hakka-*`) are checked, because those are unambiguous. Third-party type
 * imports are not checked here, since a bundler may legitimately inline them.
 * One known live example is `hakka-browser`'s declarations referencing
 * `solid-js`, which is devDependencies-only; that was judged not to break the
 * documented public API, but it is the same shape and worth revisiting.
 *
 * Run after a build: the declarations must exist to be scanned.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGES_DIR = 'packages'
/** Where each package's built declarations land. */
const BUILD_DIRS = ['dist', 'lib']
const DECL_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts']

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (DECL_SUFFIXES.some((s) => entry.endsWith(s))) out.push(full)
  }
  return out
}

/** Bare specifiers in `from '...'`, `import('...')` and `require('...')`. */
function specifiersIn(text) {
  const found = new Set()
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const m of text.matchAll(re)) found.add(m[1])
  }
  return found
}

const packageDirs = readdirSync(PACKAGES_DIR).filter((d) => {
  try {
    return statSync(join(PACKAGES_DIR, d, 'package.json')).isFile()
  } catch {
    return false
  }
})

const manifests = new Map()
for (const dir of packageDirs) {
  const pj = JSON.parse(readFileSync(join(PACKAGES_DIR, dir, 'package.json'), 'utf8'))
  manifests.set(pj.name, { dir, pj })
}
const workspaceNames = new Set(manifests.keys())

const problems = []
const noDeclarations = []
let scannedFiles = 0
let scannedPackages = 0

for (const [name, { dir, pj }] of manifests) {
  if (pj.private) continue
  scannedPackages++
  const declared = new Set([...Object.keys(pj.dependencies ?? {}), ...Object.keys(pj.peerDependencies ?? {})])
  const files = BUILD_DIRS.flatMap((b) => walk(join(PACKAGES_DIR, dir, b)))
  if (files.length === 0) noDeclarations.push(name)
  scannedFiles += files.length
  for (const file of files) {
    for (const spec of specifiersIn(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue
      // Reduce `pkg/subpath` to the package name, handling scoped names.
      const parts = spec.split('/')
      const pkgName = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (!workspaceNames.has(pkgName)) continue
      if (pkgName === name) continue // a package referring to its own subpaths is fine
      if (declared.has(pkgName)) continue
      const where = Object.keys(pj.devDependencies ?? {}).includes(pkgName)
        ? 'devDependencies only'
        : 'not declared at all'
      problems.push({ name, file, spec, pkgName, where })
    }
  }
}

if (scannedFiles === 0) {
  console.error('dep-declaration-check: found no built type declarations to scan. Run `bun run build` first.')
  process.exit(1)
}

if (problems.length > 0) {
  console.error('dep-declaration-check: FAIL\n')
  for (const p of problems) {
    console.error(`  ${p.name}: published types import "${p.spec}" but "${p.pkgName}" is ${p.where}.`)
    console.error(`    ${p.file}`)
    console.error(`    Fix: add "${p.pkgName}" to ${p.name}'s dependencies (exact version pin, as every other`)
    console.error(`    internal cross-package dependency in this repo does).\n`)
  }
  console.error(
    'A consumer who installs this package alone and runs tsc gets TS2307. The runtime bundle is\n' +
      'fine, so no smoke check catches it, and the in-repo typecheck passes because the workspace\n' +
      'resolves from source. See this script header.',
  )
  process.exit(1)
}

// Say what was NOT covered. `just verify` pre-builds only four packages, so a
// silent pass here could mean "clean" or "never looked" — the same ambiguity
// that let a shrinking smoke matrix read as success. Make it visible instead.
if (noDeclarations.length > 0) {
  console.log(
    `dep-declaration-check: NOT COVERED (no built declarations found, run \`bun run build\` for full coverage): ` +
      noDeclarations.join(', '),
  )
}
console.log(
  `dep-declaration-check: every published type declaration's cross-package import is declared ` +
    `(${scannedPackages - noDeclarations.length}/${scannedPackages} packages scanned, ${scannedFiles} declaration files)`,
)
