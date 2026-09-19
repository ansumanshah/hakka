import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
const executable = (name) => (process.platform === 'win32' ? `${name}.cmd` : name)

function start(name, args, env = process.env) {
  return spawn(executable(name), args, {
    cwd: packageDir,
    env,
    stdio: 'inherit',
  })
}

function waitFor(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

async function prepareOutput({ clean }) {
  if (clean) await rm(path.join(packageDir, 'dist'), { recursive: true, force: true })

  const moduleDirs = [
    ['react-native', 'module'],
    [path.join('react-native', 'cjs'), 'commonjs'],
  ]
  await Promise.all(
    moduleDirs.map(async ([directory, type]) => {
      const outputDir = path.join(packageDir, 'dist', directory)
      await mkdir(outputDir, { recursive: true })
      await writeFile(path.join(outputDir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`)
    }),
  )
}

async function run(name, args, label, env) {
  await waitFor(start(name, args, env), label)
}

async function build() {
  await prepareOutput({ clean: true })
  await run('vite', ['build'], 'Vite build', { ...process.env, ROZENITE_BUILD: '1' })
  await run('tsc', ['--project', 'tsconfig.react-native.esm.json'], 'ESM build')
  await run('tsc', ['--project', 'tsconfig.react-native.cjs.json'], 'CommonJS build')
}

async function dev() {
  await prepareOutput({ clean: false })

  const children = [
    start('tsc', ['--project', 'tsconfig.react-native.esm.json', '--watch', '--preserveWatchOutput']),
    start('tsc', ['--project', 'tsconfig.react-native.cjs.json', '--watch', '--preserveWatchOutput']),
    start('vite', ['dev']),
  ]

  let stop
  const stopped = new Promise((resolve) => {
    stop = resolve
  })
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    await Promise.race([
      stopped,
      ...children.map((child, index) =>
        waitFor(child, ['ESM watcher', 'CommonJS watcher', 'Vite dev server'][index]).then(() => {
          throw new Error('Development process stopped unexpectedly')
        }),
      ),
    ])
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }
  }
}

if (mode === 'build') await build()
else if (mode === 'dev') await dev()
else throw new Error('Usage: node scripts/rozenite.mjs <build|dev>')
