import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { AREAS, changedAreas } from './ci-changed-areas.mjs'

const only = (...areas) => Object.fromEntries(AREAS.map((area) => [area, areas.includes(area)]))
const all = only(...AREAS)

const cases = [
  [['docs/src/content/docs/index.mdx', 'packages/hakka-core/README.md', '.changeset/x.md'], only()],
  [['android/hakka-network/src/main/kotlin/Hakka.kt'], only('android', 'rn')],
  [['ios/Sources/HakkaCommon/Record.swift'], only('ios', 'desktop', 'rn')],
  [['apps/hakka/Sources/HakkaApp/App.swift'], only('desktop')],
  [['packages/hakka-core/src/index.ts'], only('web', 'desktop', 'rn')],
  [['packages/hakka-node/src/index.ts'], only('web', 'desktop')],
  [['packages/hakka-react-native/src/index.ts'], only('rn')],
  [['packages/hakka-react-native/ios/Core/Record.swift'], only('ios', 'rn')],
  [['examples/next-fullstack/app/page.tsx'], only('web')],
  [['examples/react-native-example/App.tsx'], only('rn')],
  [['packages/hakka-node/src/index.ts', 'android/build.gradle.kts'], only('web', 'desktop', 'android', 'rn')],
  // Workflows, scripts, lockfiles, tokens, and unclassified paths run everything.
  [['.github/workflows/ci.yml'], all],
  [['bun.lock'], all],
  [['design-tokens.json'], all],
  [['scripts/android-size-gate.sh'], all],
  [['packages/hakka-new/src/index.ts'], all],
]

for (const [paths, expected] of cases) assert.deepEqual(changedAreas(paths), expected, paths.join(', '))

const cli = (input) =>
  execFileSync(process.execPath, [fileURLToPath(new URL('./ci-changed-areas.mjs', import.meta.url))], {
    input,
    encoding: 'utf8',
  })

assert.equal(cli('docs/index.md\n'), 'web=false\nandroid=false\nios=false\ndesktop=false\nrn=false\n')
assert.equal(cli(''), 'web=true\nandroid=true\nios=true\ndesktop=true\nrn=true\n')

console.log(`ci-changed-areas: ${cases.length + 2} cases passed`)
