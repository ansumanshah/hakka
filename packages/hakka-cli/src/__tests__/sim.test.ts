import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  defaultDylibPath,
  isAppInstalled,
  parseSimAttachArgs,
  probeBridgeReachable,
  resolveDevice,
  resolveDylibPath,
  runSimAttach,
  type SimctlRunner,
} from '../sim'

/**
 * `runSimAttach` shells out to `xcrun simctl` for four different
 * subcommands (list/get_app_container/terminate/launch). Every test below
 * drives it through a fake `SimctlRunner` that dispatches on `args[0]` and
 * asserts on `runSimAttach`'s actual return code and printed log lines —
 * its observable behaviour — never on which internal helper got called.
 */
function fakeSimctl(overrides: Partial<Record<string, (args: string[]) => ReturnType<SimctlRunner>>>): SimctlRunner {
  const bootedDeviceList = JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ udid: 'AAAA-1111', name: 'iPhone 16', state: 'Booted' }],
    },
  })
  const defaults: Record<string, (args: string[]) => ReturnType<SimctlRunner>> = {
    list: () => ({ status: 0, stdout: bootedDeviceList, stderr: '' }),
    get_app_container: () => ({ status: 0, stdout: '/path/to/App.app', stderr: '' }),
    terminate: () => ({ status: 0, stdout: '', stderr: '' }),
    launch: () => ({ status: 0, stdout: 'com.example.app: 1234', stderr: '' }),
  }
  const handlers = { ...defaults, ...overrides }
  return (args) => {
    const handler = handlers[args[0] as string]
    if (!handler) throw new Error(`fakeSimctl: no handler for subcommand "${args[0]}"`)
    return handler(args)
  }
}

function collectLogs(): { log: (s: string) => void; lines: string[] } {
  const lines: string[] = []
  return { log: (s) => lines.push(s), lines }
}

describe('resolveDevice', () => {
  test('returns the sole booted device when no --device is given', () => {
    const simctl = fakeSimctl({})
    const result = resolveDevice(undefined, simctl)
    expect('error' in result).toBe(false)
    if (!('error' in result)) expect(result.udid).toBe('AAAA-1111')
  })

  test('errors when no simulator is booted', () => {
    const simctl = fakeSimctl({
      list: () => ({
        status: 0,
        stdout: JSON.stringify({ devices: { rt: [{ udid: 'X', name: 'iPhone 16', state: 'Shutdown' }] } }),
        stderr: '',
      }),
    })
    const result = resolveDevice(undefined, simctl)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/no booted simulator/)
  })

  test('errors listing every booted device when several are booted and --device is omitted', () => {
    const simctl = fakeSimctl({
      list: () => ({
        status: 0,
        stdout: JSON.stringify({
          devices: {
            rt: [
              { udid: 'AAAA', name: 'iPhone 16', state: 'Booted' },
              { udid: 'BBBB', name: 'iPhone 16 Pro', state: 'Booted' },
            ],
          },
        }),
        stderr: '',
      }),
    })
    const result = resolveDevice(undefined, simctl)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('iPhone 16 (AAAA)')
      expect(result.error).toContain('iPhone 16 Pro (BBBB)')
    }
  })

  test('resolves --device by UDID even when not booted', () => {
    const simctl = fakeSimctl({
      list: () => ({
        status: 0,
        stdout: JSON.stringify({ devices: { rt: [{ udid: 'ZZZZ', name: 'iPad', state: 'Shutdown' }] } }),
        stderr: '',
      }),
    })
    const result = resolveDevice('ZZZZ', simctl)
    expect('error' in result).toBe(false)
    if (!('error' in result)) expect(result.name).toBe('iPad')
  })

  test('resolves --device by name only among booted devices', () => {
    const simctl = fakeSimctl({})
    const result = resolveDevice('iPhone 16', simctl)
    expect('error' in result).toBe(false)
    if (!('error' in result)) expect(result.udid).toBe('AAAA-1111')
  })

  test('errors when --device matches nothing booted or by UDID', () => {
    const simctl = fakeSimctl({})
    const result = resolveDevice('does-not-exist', simctl)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('does-not-exist')
  })

  test('errors when `xcrun simctl list` itself fails', () => {
    const simctl = fakeSimctl({ list: () => ({ status: 1, stdout: '', stderr: 'no such tool' }) })
    const result = resolveDevice(undefined, simctl)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('no such tool')
  })

  test('errors when the device list is not valid JSON', () => {
    const simctl = fakeSimctl({ list: () => ({ status: 0, stdout: 'not json', stderr: '' }) })
    const result = resolveDevice(undefined, simctl)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/could not parse/)
  })
})

describe('isAppInstalled', () => {
  test('true when `simctl get_app_container` exits 0', () => {
    const simctl = fakeSimctl({ get_app_container: () => ({ status: 0, stdout: '/App.app', stderr: '' }) })
    expect(isAppInstalled('AAAA', 'com.example.app', simctl)).toBe(true)
  })

  test('false when `simctl get_app_container` exits non-zero', () => {
    const simctl = fakeSimctl({
      get_app_container: () => ({ status: 2, stdout: '', stderr: 'No such file or directory' }),
    })
    expect(isAppInstalled('AAAA', 'com.example.bogus', simctl)).toBe(false)
  })
})

describe('parseSimAttachArgs', () => {
  test('parses a bare bundle id with no flags', () => {
    expect(parseSimAttachArgs(['com.example.app'])).toEqual({ bundleId: 'com.example.app' })
  })

  test('parses every flag regardless of position relative to the bundle id', () => {
    const opts = parseSimAttachArgs([
      '--device',
      'iPhone 16',
      'com.example.app',
      '--dylib',
      '/tmp/x.dylib',
      '--bridge-url',
      'ws://127.0.0.1:9999',
    ])
    expect(opts).toEqual({
      bundleId: 'com.example.app',
      device: 'iPhone 16',
      dylibPath: '/tmp/x.dylib',
      bridgeUrl: 'ws://127.0.0.1:9999',
    })
  })

  test('returns undefined when no bundle id is given', () => {
    expect(parseSimAttachArgs(['--device', 'iPhone 16'])).toBeUndefined()
    expect(parseSimAttachArgs([])).toBeUndefined()
  })
})

describe('defaultDylibPath', () => {
  test('resolves to the just build-siminject output, three levels above the module dir', () => {
    const fakeModuleDir = '/repo/packages/hakka-cli/src'
    expect(defaultDylibPath(fakeModuleDir)).toBe(
      '/repo/ios/SimInject/.build/xcode-sim/Debug-iphonesimulator/PackageFrameworks/HakkaSimInject.framework/HakkaSimInject',
    )
  })
})

describe('resolveDylibPath', () => {
  let dir: string
  const originalEnv = process.env.HAKKA_SIM_INJECT_DYLIB

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hakka-sim-dylib-test-'))
    delete process.env.HAKKA_SIM_INJECT_DYLIB
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (originalEnv === undefined) delete process.env.HAKKA_SIM_INJECT_DYLIB
    else process.env.HAKKA_SIM_INJECT_DYLIB = originalEnv
  })

  test('--dylib wins when the file exists', () => {
    const p = join(dir, 'HakkaSimInject')
    writeFileSync(p, 'fake')
    const result = resolveDylibPath({ bundleId: 'x', dylibPath: p })
    expect('path' in result).toBe(true)
    if ('path' in result) {
      expect(result.path).toBe(p)
      expect(result.source).toBe('--dylib')
    }
  })

  test('--dylib errors clearly when the file does not exist', () => {
    const p = join(dir, 'missing')
    const result = resolveDylibPath({ bundleId: 'x', dylibPath: p })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain(p)
      expect(result.error).toContain('--dylib')
    }
  })

  test('HAKKA_SIM_INJECT_DYLIB is used when no --dylib flag is given', () => {
    const p = join(dir, 'HakkaSimInject')
    writeFileSync(p, 'fake')
    process.env.HAKKA_SIM_INJECT_DYLIB = p
    const result = resolveDylibPath({ bundleId: 'x' })
    expect('path' in result).toBe(true)
    if ('path' in result) {
      expect(result.path).toBe(p)
      expect(result.source).toBe('HAKKA_SIM_INJECT_DYLIB')
    }
  })

  test('HAKKA_SIM_INJECT_DYLIB errors clearly when its path does not exist', () => {
    const p = join(dir, 'missing')
    process.env.HAKKA_SIM_INJECT_DYLIB = p
    const result = resolveDylibPath({ bundleId: 'x' })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain(p)
      expect(result.error).toContain('HAKKA_SIM_INJECT_DYLIB')
    }
  })

  test('--dylib takes priority over HAKKA_SIM_INJECT_DYLIB when both are set', () => {
    const flagPath = join(dir, 'flag')
    const envPath = join(dir, 'env')
    writeFileSync(flagPath, 'fake')
    writeFileSync(envPath, 'fake')
    process.env.HAKKA_SIM_INJECT_DYLIB = envPath
    const result = resolveDylibPath({ bundleId: 'x', dylibPath: flagPath })
    expect('path' in result).toBe(true)
    if ('path' in result) expect(result.path).toBe(flagPath)
  })

  // These two exercise the real `just build-siminject` default path (no
  // moduleDir override) end to end, since that is the actual code path
  // `hakka sim attach` runs. They never delete pre-existing content: the
  // "found" case only creates a fixture if none exists yet and removes
  // exactly what it made; the "missing" case only ever renames a real
  // build aside and restores it, never deletes it.
  describe('auto-discovery against the real just build-siminject path', () => {
    const autoPath = defaultDylibPath()

    test('finds it when present, with no flag or env var set', () => {
      const alreadyExists = existsSync(autoPath)
      if (!alreadyExists) {
        mkdirSync(dirname(autoPath), { recursive: true })
        writeFileSync(autoPath, 'fake dylib for test')
      }
      try {
        const result = resolveDylibPath({ bundleId: 'x' })
        expect('path' in result).toBe(true)
        if ('path' in result) {
          expect(result.path).toBe(autoPath)
          expect(result.source).toBe('just build-siminject')
        }
      } finally {
        if (!alreadyExists) rmSync(autoPath, { force: true })
      }
    })

    test('errors with a `just build-siminject` hint when nothing is found anywhere', () => {
      const backupPath = `${autoPath}.sim-test-backup`
      const existed = existsSync(autoPath)
      if (existed) renameSync(autoPath, backupPath)
      try {
        const result = resolveDylibPath({ bundleId: 'x' })
        expect('error' in result).toBe(true)
        if ('error' in result) {
          expect(result.error).toContain('just build-siminject')
          expect(result.error).toContain('--dylib')
          expect(result.error).toContain('HAKKA_SIM_INJECT_DYLIB')
        }
      } finally {
        if (existed) renameSync(backupPath, autoPath)
      }
    })
  })
})

describe('probeBridgeReachable', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (!server) return
    const toClose = server
    server = undefined
    await new Promise<void>((resolve) => toClose.close(() => resolve()))
  })

  test('true against a real listening socket', async () => {
    server = createServer()
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
    })
    const reachable = await probeBridgeReachable(`ws://127.0.0.1:${port}`)
    expect(reachable).toBe(true)
  })

  test('false against a closed port', async () => {
    server = createServer()
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
    })
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
    const reachable = await probeBridgeReachable(`ws://127.0.0.1:${port}`, 200)
    expect(reachable).toBe(false)
  })

  test('false for an unparsable URL', async () => {
    const reachable = await probeBridgeReachable('not a url')
    expect(reachable).toBe(false)
  })
})

describe('runSimAttach', () => {
  let dir: string
  let dylibPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hakka-sim-attach-test-'))
    dylibPath = join(dir, 'HakkaSimInject')
    writeFileSync(dylibPath, 'fake dylib for test')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('happy path: booted device, dylib present, app installed, hub reachable, launch succeeds', async () => {
    const { log, lines } = collectLogs()
    const simctl = fakeSimctl({})
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath }, log, {
      simctl,
      probeBridge: async () => true,
    })
    expect(code).toBe(0)
    expect(lines.some((l) => l.includes(dylibPath))).toBe(true)
    expect(lines.some((l) => l.includes('Capture is streaming'))).toBe(true)
    expect(lines.some((l) => l.toLowerCase().includes('warning'))).toBe(false)
  })

  test('fails with an actionable message when no simulator is booted', async () => {
    const { log, lines } = collectLogs()
    const simctl = fakeSimctl({
      list: () => ({
        status: 0,
        stdout: JSON.stringify({ devices: {} }),
        stderr: '',
      }),
    })
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath }, log, { simctl })
    expect(code).toBe(1)
    expect(lines.join('\n')).toMatch(/no booted simulator/)
  })

  test('fails with a build hint when the dylib cannot be found', async () => {
    const { log, lines } = collectLogs()
    const simctl = fakeSimctl({})
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath: join(dir, 'does-not-exist') }, log, {
      simctl,
    })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('dylib not found')
  })

  test('fails with an install hint when the app is not installed, without attempting to launch', async () => {
    const { log, lines } = collectLogs()
    let launchWasCalled = false
    const simctl = fakeSimctl({
      get_app_container: () => ({ status: 2, stdout: '', stderr: 'No such file or directory' }),
      launch: () => {
        launchWasCalled = true
        return { status: 0, stdout: '', stderr: '' }
      },
    })
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath }, log, { simctl })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('is not installed')
    expect(lines.join('\n')).toContain('com.example.app')
    expect(launchWasCalled).toBe(false)
  })

  test('warns but still launches when the bridge hub is unreachable', async () => {
    const { log, lines } = collectLogs()
    const simctl = fakeSimctl({})
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath }, log, {
      simctl,
      probeBridge: async () => false,
    })
    expect(code).toBe(0)
    expect(lines.join('\n')).toContain('warning')
    expect(lines.join('\n')).toContain('npx hakka-bridge')
  })

  test('fails with the trimmed simctl error when launch itself fails unexpectedly', async () => {
    const { log, lines } = collectLogs()
    const simctl = fakeSimctl({
      launch: () => ({
        status: 4,
        stdout: '',
        stderr: 'An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=4)',
      }),
    })
    const code = await runSimAttach({ bundleId: 'com.example.app', dylibPath }, log, { simctl })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('FBSOpenApplicationServiceErrorDomain')
  })

  test('passes the resolved dylib path and bridge URL through SIMCTL_CHILD_ env vars on launch', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    const simctl: SimctlRunner = (args, env) => {
      if (args[0] === 'launch') capturedEnv = env
      return fakeSimctl({})(args, env)
    }
    const code = await runSimAttach(
      { bundleId: 'com.example.app', dylibPath, bridgeUrl: 'ws://127.0.0.1:9999' },
      () => {},
      { simctl, probeBridge: async () => true },
    )
    expect(code).toBe(0)
    expect(capturedEnv?.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES).toBe(dylibPath)
    expect(capturedEnv?.SIMCTL_CHILD_HAKKA_BRIDGE_URL).toBe('ws://127.0.0.1:9999')
  })
})
