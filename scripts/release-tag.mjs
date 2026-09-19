#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const [mode] = process.argv.slice(2)
const version = process.env.RELEASE_VERSION
const requestedCommit = process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA

if (!['verify', 'require', 'create'].includes(mode)) {
  throw new Error('Usage: release-tag.mjs <verify|require|create>')
}

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('RELEASE_VERSION must be a semantic version without a v prefix')
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function hasRef(ref) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

const tag = `v${version}`
const target = git('rev-parse', '--verify', `${requestedCommit}^{commit}`)
const ref = `refs/tags/${tag}`

if (hasRef(ref)) {
  const taggedCommit = git('rev-parse', '--verify', `${ref}^{commit}`)
  if (taggedCommit !== target) {
    throw new Error(`${tag} already points to ${taggedCommit}, not selected commit ${target}`)
  }
  console.log(`${tag} already points to selected commit ${target}`)
} else if (mode === 'create') {
  // This creates only a local annotated tag. The workflow publishes its exact
  // ref, so a concurrent or conflicting remote tag makes it fail.
  git('tag', '--annotate', tag, target, '--message', `Hakka ${version}`)
  console.log(`Created ${tag} at selected commit ${target}`)
} else if (mode === 'require') {
  throw new Error(`${tag} does not exist at selected commit ${target}`)
} else {
  console.log(`${tag} does not exist yet; selected commit is ${target}`)
}
