import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const rnPackagePath = 'packages/hakka-react-native/package.json'
const rnPackage = JSON.parse(read(rnPackagePath))
const expectedVersion = rnPackage.version
const failures = []
const skippedDirectoryNames = new Set([
  '__tests__',
  'DerivedData',
  'Pods',
  'artifacts',
  'bin',
  'build',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'playwright-report',
  'target',
  'test-results',
  '__pycache__',
])

const skippedPaths = new Set([
  'examples/react-native-benchmark',
  'examples/expo-example/android',
  'examples/expo-example/ios',
])

checkFileVersion('ios/Hakka.podspec', /s\.version\s*=\s*"([^"]+)"/, 'iOS podspec')
// Hardcoded source constants — misreport themselves in health reports if they
// drift from the released version.
checkFileVersion(
  'packages/hakka-cli/src/cdp/index.ts',
  /HAKKA_CDP_VERSION\s*=\s*'([^']+)'/,
  'HAKKA_CDP_VERSION constant',
)
checkFileVersion(
  'packages/hakka-core/src/index.ts',
  /HAKKA_CORE_VERSION\s*=\s*'([^']+)'/,
  'HAKKA_CORE_VERSION constant',
)
checkFileVersion(
  'packages/hakka-bridge/src/index.ts',
  /HAKKA_BRIDGE_VERSION\s*=\s*'([^']+)'/,
  'HAKKA_BRIDGE_VERSION constant',
)
checkFileContains(
  'packages/hakka-react-native/Hakka.podspec',
  /s\.version\s*=\s*package\["version"\]/,
  'React Native package podspec must derive from package.json',
)
checkFileVersion(
  'packages/hakka-react-native/app.plugin.js',
  /DEFAULT_ANDROID_MAVEN_VERSION\s*=\s*'([^']+)'/,
  'Expo plugin Android Maven default',
)

for (const file of [
  'android/hakka-common/build.gradle.kts',
  'android/hakka-network/build.gradle.kts',
  'android/hakka-network-noop/build.gradle.kts',
  'android/hakka-performance/build.gradle.kts',
  'android/hakka-performance-noop/build.gradle.kts',
  'android/hakka-ui/build.gradle.kts',
]) {
  checkFileVersion(file, /version\s*=\s*"([^"]+)"/, `${file} version`)
  checkFileVersion(file, /coordinates\("com\.noodleapps\.hakka",\s*"[^"]+",\s*"([^"]+)"\)/, `${file} Maven coordinates`)
}

// All published JS workspace packages must move in lockstep with the release version.
for (const file of [
  'packages/hakka-core/package.json',
  'packages/hakka-browser/package.json',
  'packages/hakka-bridge/package.json',
  'packages/hakka-node/package.json',
  'packages/hakka-react-native/package.json',
  'packages/hakka-cli/package.json',
  'packages/hakka-rozenite/package.json',
]) {
  checkFileVersion(file, /"version":\s*"([^"]+)"/, `${file} version`)
}

// Exact internal dependency pins must track the release version (range pins like ">=" are intentional and skipped).
for (const { file, dep } of [
  { file: 'packages/hakka-browser/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-bridge/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-node/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-node/package.json', dep: 'hakka-bridge' },
  { file: 'packages/hakka-react-native/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-rozenite/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-rozenite/package.json', dep: 'hakka-browser' },
  { file: 'packages/hakka-rozenite/package.json', dep: 'hakka-react-native' },
  { file: 'packages/hakka-cli/package.json', dep: 'hakka-core' },
  { file: 'packages/hakka-cli/package.json', dep: 'hakka-bridge' },
]) {
  checkFileVersion(file, new RegExp(`"${dep}":\\s*"([^"]+)"`), `${file} pin on ${dep}`)
}

for (const match of findMavenCoordinateVersions()) {
  if (match.version !== expectedVersion) {
    failures.push(
      `${match.file}:${match.line} uses ${match.version} for ${match.coordinate}; expected ${expectedVersion}`,
    )
  }
}

if (failures.length > 0) {
  console.error(`Version audit failed for Hakka ${expectedVersion}:`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Version audit passed for Hakka ${expectedVersion}`)

function checkFileVersion(file, pattern, label) {
  const contents = read(file)
  const match = contents.match(pattern)
  if (!match) {
    failures.push(`${label}: version pattern was not found`)
    return
  }
  if (match[1] !== expectedVersion) {
    failures.push(`${label}: ${match[1]} does not match ${expectedVersion}`)
  }
}

function checkFileContains(file, pattern, label) {
  if (!pattern.test(read(file))) {
    failures.push(label)
  }
}

function findMavenCoordinateVersions() {
  const matches = []
  for (const file of walk(root)) {
    const rel = relative(root, file)
    const contents = read(rel)
    const lines = contents.split('\n')
    for (const [index, line] of lines.entries()) {
      const coordinatePattern = /com\.noodleapps\.hakka:([^"'\s)]+):(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/g
      let match
      while ((match = coordinatePattern.exec(line)) != null) {
        matches.push({
          file: rel,
          line: index + 1,
          coordinate: match[1],
          version: match[2],
        })
      }
    }
  }
  return matches
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Tool state, test fixtures and pinned benchmark baselines are not release coordinates.
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    if (skippedDirectoryNames.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (skippedPaths.has(relative(root, path))) continue
    if (entry.isDirectory()) {
      yield* walk(path)
    } else if (entry.isFile() && isTextFile(path)) {
      yield path
    }
  }
}

function isTextFile(path) {
  return /\.(gradle|kts|md|mjs|js|json|podspec|properties|swift|ts|tsx|xml|ya?ml)$/.test(path)
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}
