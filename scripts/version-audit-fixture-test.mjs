import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureRoot = mkdtempSync(join(tmpdir(), 'hakka-version-audit-'))
const requiredFiles = [
  'ios/Hakka.podspec',
  'packages/hakka-cli/src/cdp/index.ts',
  'packages/hakka-core/src/index.ts',
  'packages/hakka-bridge/src/index.ts',
  'packages/hakka-react-native/Hakka.podspec',
  'packages/hakka-react-native/app.plugin.js',
  ...[
    'hakka-common',
    'hakka-network',
    'hakka-network-noop',
    'hakka-performance',
    'hakka-performance-noop',
    'hakka-ui',
  ].map((module) => `android/${module}/build.gradle.kts`),
  ...[
    'hakka-core',
    'hakka-browser',
    'hakka-bridge',
    'hakka-node',
    'hakka-react-native',
    'hakka-cli',
    'hakka-rozenite',
  ].map((module) => `packages/${module}/package.json`),
]

try {
  copy('scripts/version-audit.mjs')
  for (const file of requiredFiles) copy(file)

  write('docs/release.md', `Current release\n${coordinate('real-module', '9.9.9')}\n`)
  write('.github/workflows/release.yml', `${coordinate('workflow-module', '9.9.9')}\n`)
  for (const directory of [
    '.agent',
    '.agents',
    '.claude',
    '.worktrees/stale',
    'build',
    'packages/example/__tests__',
    'examples/react-native-benchmark/scripts',
    'examples/expo-example/android/app',
    'examples/expo-example/ios',
  ]) {
    write(`${directory}/stale.md`, `${coordinate('stale-module', '8.8.8')}\n`)
  }
  symlinkSync('missing-target', join(fixtureRoot, 'broken-link'))
  symlinkSync('.', join(fixtureRoot, 'cyclic-link'))
  symlinkSync('../.agent/screenshots', join(fixtureRoot, '.claude', 'screenshots'))

  const result = spawnSync(process.execPath, ['scripts/version-audit.mjs'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
  const output = `${result.stdout}${result.stderr}`
  if (result.status !== 1) {
    throw new Error(`Expected a version mismatch failure, received ${result.status}:\n${output}`)
  }
  if (!output.includes('docs/release.md:2 uses 9.9.9 for real-module')) {
    throw new Error(`Expected the real mismatch with its file and line:\n${output}`)
  }
  if (output.includes('stale-module')) {
    throw new Error(`Ignored directories contributed a stale coordinate:\n${output}`)
  }
  if (!output.includes('.github/workflows/release.yml:1 uses 9.9.9 for workflow-module')) {
    throw new Error(`Expected workflow coordinates to remain checked:\n${output}`)
  }

  write('docs/release.md', 'No version mismatch\n')
  write('.github/workflows/release.yml', 'No version mismatch\n')
  const passing = spawnSync(process.execPath, ['scripts/version-audit.mjs'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (passing.status !== 0) {
    throw new Error(`Expected aligned versions to pass:\n${passing.stdout}${passing.stderr}`)
  }

  console.log('Version audit fixture test passed')
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true })
}

function copy(file) {
  const destination = join(fixtureRoot, file)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join(repositoryRoot, file), destination)
}

function write(file, contents) {
  const destination = join(fixtureRoot, file)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, contents)
}

function coordinate(module, version) {
  return ['com.noodleapps.hakka', module, version].join(':')
}
