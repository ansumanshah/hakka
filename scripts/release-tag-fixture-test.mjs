import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'hakka-release-tag-'))
const script = join(root, 'scripts/release-tag.mjs')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function run(mode, commit) {
  return spawnSync(process.execPath, [script, mode], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_VERSION: '0.1.1', RELEASE_COMMIT: commit },
  })
}

try {
  cpSync('scripts/release-tag.mjs', script)
  git('init', '--quiet')
  const remote = mkdtempSync(join(tmpdir(), 'hakka-release-tag-remote-'))
  execFileSync('git', ['init', '--bare', '--quiet', remote])
  git('remote', 'add', 'origin', remote)
  git('config', 'user.email', 'release-test@example.invalid')
  git('config', 'user.name', 'Release test')
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '--message', 'first'], { cwd: root })
  const first = git('rev-parse', 'HEAD')

  const missing = run('require', first)
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /does not exist/)
  assert.equal(git('ls-remote', '--tags', 'origin'), '', 'requiring a tag must not write to the remote')

  const created = run('create', first)
  assert.equal(created.status, 0, created.stderr)
  assert.equal(git('rev-parse', 'v0.1.1^{commit}'), first)
  assert.equal(git('ls-remote', '--tags', 'origin'), '', 'creating a tag must not write to the remote')
  const required = run('require', first)
  assert.equal(required.status, 0, required.stderr)

  execFileSync('git', ['commit', '--allow-empty', '--quiet', '--message', 'second'], { cwd: root })
  const second = git('rev-parse', 'HEAD')
  const mismatch = run('create', second)
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.stderr, /already points to/)
  assert.equal(git('rev-parse', 'v0.1.1^{commit}'), first, 'mismatch must not move the tag')

  const tagMessage = execFileSync('git', ['show', '--format=%B', '--no-patch', 'v0.1.1'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.match(tagMessage, /Hakka 0\.1\.1/, 'created tag is annotated')
  rmSync(remote, { recursive: true, force: true })
  console.log('release tag fixture checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
