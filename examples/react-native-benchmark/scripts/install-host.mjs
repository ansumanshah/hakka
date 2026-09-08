import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(process.env.HAKKA_RN_BENCHMARK_HOST ?? process.argv[2] ?? '')
const npmCache = process.env.HAKKA_RN_BENCHMARK_NPM_CACHE

if (!process.env.HAKKA_RN_BENCHMARK_HOST && !process.argv[2]) {
  throw new Error('Pass a destination or set HAKKA_RN_BENCHMARK_HOST')
}
if (existsSync(destination)) throw new Error(`Benchmark host already exists: ${destination}`)

const bootstrap = `${destination}.bootstrap`
if (existsSync(bootstrap)) throw new Error(`Remove the incomplete bootstrap first: ${bootstrap}`)
mkdirSync(bootstrap, { recursive: true })

try {
  cpSync(resolve(fixtureDir, 'package.json'), resolve(bootstrap, 'package.json'))
  cpSync(resolve(fixtureDir, 'package-lock.json'), resolve(bootstrap, 'package-lock.json'))
  run('npm', ['ci', '--ignore-scripts', ...(npmCache ? ['--cache', resolve(npmCache)] : [])], bootstrap)

  const cli = resolve(bootstrap, 'node_modules/@react-native-community/cli/build/bin.js')
  run(
    process.execPath,
    [
      cli,
      'init',
      'HakkaRNExample',
      '--version',
      '0.87.1',
      '--directory',
      destination,
      '--pm',
      'npm',
      '--skip-install',
      '--skip-git-init',
      '--package-name',
      'com.noodleapps.hakka.rn',
    ],
    dirname(destination),
  )

  cpSync(resolve(fixtureDir, 'package.json'), resolve(destination, 'package.json'))
  cpSync(resolve(fixtureDir, 'package-lock.json'), resolve(destination, 'package-lock.json'))
  renameSync(resolve(bootstrap, 'node_modules'), resolve(destination, 'node_modules'))
  rmSync(bootstrap, { recursive: true })
  console.log(`Installed React Native 0.87.1 benchmark host at ${destination}`)
} catch (error) {
  console.error(`Incomplete bootstrap preserved at ${bootstrap}`)
  throw error
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}
