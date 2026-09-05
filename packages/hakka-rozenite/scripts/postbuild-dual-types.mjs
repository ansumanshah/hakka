/**
 * `rozenite build` owns the package's root entry and rewrites it on every
 * build. Rozenite 2 emits a module-aware layout with ESM in
 * `dist/react-native/` and CommonJS in `dist/react-native/cjs/`, so its
 * managed root export is already safe for both consumers.
 *
 * Hakka also documents an explicit `hakka-rozenite/react-native` subpath.
 * Rozenite does not manage that alias, so copy the generated root mapping to
 * the subpath after every build to keep both entry points in sync.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(pkgDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const managedEntry = pkg.exports?.['.']
if (!managedEntry) {
  throw new Error('rozenite build did not generate the root package export')
}
pkg.exports['./react-native'] = managedEntry

// Same formatting rozenite's own writer uses, so builds stay diff-stable.
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
process.stdout.write('postbuild-dual-types: ./react-native synced to the Rozenite 2 root export\n')
