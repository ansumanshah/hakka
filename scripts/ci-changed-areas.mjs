#!/usr/bin/env node
// Map changed repository paths (one per line on stdin) to the CI areas they
// can affect, printed as `area=true|false` lines for $GITHUB_OUTPUT.
//
// Unknown paths select every area, so a new directory or root file runs the
// full suite until it is classified here. Documentation-only paths select none;
// the always-on Lint & Format and TypeScript jobs still cover them.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const AREAS = ['web', 'android', 'ios', 'desktop', 'rn']

// Packages the React Native example, Rozenite plugin, and desktop transport
// tests consume. hakka-node and hakka-cli are desktop and web only.
const SHARED_JS_PACKAGES = new Set(['hakka-core', 'hakka-bridge', 'hakka-browser'])
const RN_EXAMPLES = new Set(['react-native-example', 'expo-example', 'react-native-benchmark', 'rozenite'])

const DOCS_ONLY = [/^docs\//, /\.mdx?$/, /^\.changeset\//, /^LICENSE$/]

/** @returns {string[] | null} areas for one path, or null when unclassified. */
function areasFor(path) {
  if (DOCS_ONLY.some((pattern) => pattern.test(path))) return []
  if (path.startsWith('android/')) return ['android', 'rn']
  if (path.startsWith('ios/')) return ['ios', 'desktop', 'rn']
  if (path.startsWith('apps/hakka/')) return ['desktop']

  const pkg = path.match(/^packages\/([^/]+)\//)?.[1]
  if (pkg === 'hakka-react-native') return path.startsWith(`packages/${pkg}/ios/`) ? ['ios', 'rn'] : ['rn']
  if (pkg === 'hakka-rozenite') return ['rn']
  if (pkg === 'hakka-node' || pkg === 'hakka-cli') return ['web', 'desktop']
  if (pkg === 'hakka-bench') return ['web']
  if (pkg !== undefined && SHARED_JS_PACKAGES.has(pkg)) return ['web', 'desktop', 'rn']

  const example = path.match(/^examples\/([^/]+)\//)?.[1]
  if (example !== undefined) return RN_EXAMPLES.has(example) ? ['rn'] : ['web']

  return null
}

export function changedAreas(paths) {
  const selected = new Set()
  for (const path of paths) {
    const areas = areasFor(path) ?? AREAS
    for (const area of areas) selected.add(area)
  }
  return Object.fromEntries(AREAS.map((area) => [area, selected.has(area)]))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  // An empty diff is unexpected for a PR; run everything rather than nothing.
  const result = paths.length === 0 ? changedAreas(['<empty diff>']) : changedAreas(paths)
  for (const [area, selected] of Object.entries(result)) console.log(`${area}=${selected}`)
}
