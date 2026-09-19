import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Prepare once for the whole run: project workers must not replace assets while
// another browser is loading the standalone-components fixture.
export default function setup(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const distDir = join(here, '..', 'dist', 'elements')
  const fixtureDistDir = join(here, 'fixtures', 'components-dist')
  if (!existsSync(join(distDir, 'index.js'))) {
    throw new Error('Build hakka-browser before running E2E: bun run build')
  }
  rmSync(fixtureDistDir, { recursive: true, force: true })
  mkdirSync(fixtureDistDir, { recursive: true })
  for (const name of readdirSync(distDir)) {
    if (!name.endsWith('.js')) continue
    const raw = readFileSync(join(distDir, name), 'utf8')
    writeFileSync(join(fixtureDistDir, name), raw.replace(/\/\/# sourceMappingURL=\S*$/m, ''))
  }
}
