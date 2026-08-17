/**
 * `rozenite build` owns `exports["."]` — its CLI (`mergeManagedExports`)
 * rewrites it to a flat { types, import, require } block on every build,
 * where the single ESM-shaped .d.ts also serves require() consumers: the
 * dual-package-hazard publint flags. Rozenite has no option to emit a .d.cts
 * or to leave "." alone, so this postbuild step (wired into the `build`
 * script) re-applies the correct shape after every build:
 *
 *   1. copy index.d.ts -> index.d.cts (valid here: the declaration file is
 *      self-contained, named-exports-only, no default — under the .cts
 *      extension TS reads the same syntax as CJS-shaped named exports,
 *      matching dist/react-native/index.cjs)
 *   2. split "." and "./react-native" into per-condition types.
 *
 * If a rozenite upgrade changes its contract paths, update DIST here too.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = 'dist/react-native'

copyFileSync(path.join(pkgDir, DIST, 'index.d.ts'), path.join(pkgDir, DIST, 'index.d.cts'))

const pkgPath = path.join(pkgDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const dualEntry = {
  import: { types: `./${DIST}/index.d.ts`, default: `./${DIST}/index.js` },
  require: { types: `./${DIST}/index.d.cts`, default: `./${DIST}/index.cjs` },
}
pkg.exports['.'] = dualEntry
pkg.exports['./react-native'] = dualEntry

// Same formatting rozenite's own writer uses, so builds stay diff-stable.
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
process.stdout.write('postbuild-dual-types: exports split per condition, index.d.cts emitted\n')
