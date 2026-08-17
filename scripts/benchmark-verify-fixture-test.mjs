#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifier = path.join(repoRoot, 'scripts/benchmark-verify.mjs')

function writeJson(root, relativePath, payload) {
  const file = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
}

function runtime(variant, averageDurationMs, environment = null, inspector = null) {
  return {
    variant,
    environment,
    summary: {
      count: 100,
      successCount: 100,
      failureCount: 0,
      totalDurationMs: averageDurationMs * 100,
      averageDurationMs,
      requestsPerSecond: 1000 / averageDurationMs,
    },
    ...(inspector ? { inspector } : {}),
  }
}

function hakkaInspector() {
  return {
    capturedRecords: 100,
    droppedSinkRecords: 0,
    performanceRunning: true,
    performanceSampleIntervalMs: 1000,
  }
}

function physicalEnvironment(platform, id) {
  return {
    platform,
    targetKind: 'physical',
    collectedAt: '2026-05-16T00:00:00.000Z',
    runner: platform === 'android' ? 'android-physical-benchmark' : 'ios-physical-run',
    ...(platform === 'android' ? { deviceSerial: id } : { deviceId: id }),
  }
}

function flashlight(environment = null) {
  return {
    environment,
    iterations: Array.from({ length: 10 }, () => ({
      status: 'SUCCESS',
      measures: [{ fps: 60 }],
    })),
  }
}

function iosSummary(environment = null) {
  return {
    variants: [
      variantSummary('baseline', 14, environment),
      variantSummary('hakka', 13, environment, {
        minCapturedRecords: 100,
        maxDroppedSinkRecords: 0,
        allPerformanceRunning: true,
        minPerformanceSampleIntervalMs: 1000,
      }),
      variantSummary('wormholy', 32, environment),
      variantSummary('pulse', 14, environment),
    ],
  }
}

function variantSummary(variant, meanAverageDurationMs, environment = null, inspector = null) {
  return {
    variant,
    runs: 3,
    countPerRun: 100,
    successPerRun: 100,
    maxFailureCount: 0,
    meanAverageDurationMs,
    meanRequestsPerSecond: 1000 / meanAverageDurationMs,
    samples: [meanAverageDurationMs, meanAverageDurationMs, meanAverageDurationMs],
    environment,
    inspector,
  }
}

function seedFixture(root, options = {}) {
  const androidSerial = options.androidSerial ?? 'android-ready'
  const iosDeviceId = options.iosDeviceId ?? 'ios-ready'
  const androidEnvironment = physicalEnvironment('android', androidSerial)
  const iosEnvironment = {
    targetKinds: ['physical'],
    platforms: ['ios'],
    deviceIds: [iosDeviceId],
    runners: ['ios-physical-run'],
    collectedAts: ['2026-05-16T00:00:00.000Z'],
  }

  for (const [variant, average] of [
    ['baseline', 15],
    ['hakka', 14],
    ['chucker', 20],
  ]) {
    writeJson(
      root,
      `artifacts/benchmarks/android/${variant}-runtime.json`,
      runtime(variant, average, null, variant === 'hakka' ? hakkaInspector() : null),
    )
    writeJson(
      root,
      `artifacts/benchmarks/physical/android/${variant}-runtime.json`,
      runtime(variant, average, androidEnvironment, variant === 'hakka' ? hakkaInspector() : null),
    )
  }

  writeJson(root, 'artifacts/benchmarks/android/apk-sizes.json', {
    rows: [
      { variant: 'baseline', buildType: 'release', bytes: 1000 },
      { variant: 'hakka', buildType: 'release', bytes: 1010 },
      { variant: 'hakka', buildType: 'debug', bytes: 1500 },
      { variant: 'chucker', buildType: 'debug', bytes: 3000 },
    ],
  })

  for (const [variant, average] of [
    ['baseline', 14],
    ['hakka', 13],
    ['wormholy', 32],
    ['pulse', 14],
  ]) {
    writeJson(
      root,
      `artifacts/benchmarks/ios/${variant}-runtime.json`,
      runtime(variant, average, null, variant === 'hakka' ? hakkaInspector() : null),
    )
  }

  writeJson(root, 'artifacts/benchmarks/ios/app-sizes.json', {
    rows: [
      { variant: 'BenchmarkHakka', configuration: 'Debug', bytes: 1000 },
      { variant: 'BenchmarkWormholy', configuration: 'Debug', bytes: 2000 },
      { variant: 'BenchmarkPulse', configuration: 'Debug', bytes: 3000 },
      { variant: 'BenchmarkHakka', configuration: 'Release', bytes: 900 },
    ],
  })
  writeJson(root, 'artifacts/benchmarks/ios/runtime-summary.json', iosSummary())
  writeJson(root, 'artifacts/benchmarks/physical/ios/runtime-summary.json', iosSummary(iosEnvironment))

  writeJson(root, 'artifacts/benchmarks/rn/modes-runtime.json', {
    rows: [
      rnMode('native', 100, 0),
      rnMode('js', 0, 100),
      rnMode('auto-native', 100, 0),
      rnMode('auto-fallback', 0, 100),
    ],
  })

  writeJson(root, 'artifacts/flashlight-rn-android-10iter.json', flashlight())
  writeJson(root, 'artifacts/benchmarks/physical/android/flashlight-rn.json', flashlight(androidEnvironment))

  writeJson(root, 'readiness.json', {
    android: {
      commandAvailable: true,
      ready: true,
      readyDevices: [{ serial: 'android-ready' }],
    },
    ios: {
      commandAvailable: true,
      ready: true,
      readyDevices: [{ id: 'ios-ready', name: 'iPhone' }],
      offlineDevices: [],
    },
  })
}

function rnMode(name, nativeRecords, jsRecords) {
  return {
    name,
    requestedCount: 100,
    capturedRecords: 100,
    uniqueRecordIds: 100,
    duplicateRecords: 0,
    nativeRecords,
    jsRecords,
  }
}

function runVerifier(root) {
  return spawnSync(process.execPath, [verifier, '--strict-physical'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HAKKA_BENCHMARK_ROOT: root,
      HAKKA_DEVICE_READINESS_FILE: path.join(root, 'readiness.json'),
    },
    encoding: 'utf8',
  })
}

function withFixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hakka-benchmark-verify-'))
  try {
    seedFixture(root)
    callback(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function rewriteJson(file, update) {
  const payload = readJson(file)
  update(payload)
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
}

withFixture((root) => {
  const result = runVerifier(root)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/android/hakka-runtime.json')
  rewriteJson(file, (payload) => {
    payload.environment.deviceSerial = 'other-android'
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical android hakka metadata device serial is currently ready/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/android/hakka-runtime.json')
  rewriteJson(file, (payload) => {
    delete payload.environment
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical android hakka includes physical-target metadata/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/android/hakka-runtime.json')
  rewriteJson(file, (payload) => {
    payload.environment.collectedAt = 'not-a-timestamp'
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical android hakka metadata collection timestamp is a valid ISO timestamp/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/android/chucker-runtime.json')
  rewriteJson(file, (payload) => {
    payload.environment.deviceSerial = 'android-ready-2'
  })
  rewriteJson(path.join(root, 'readiness.json'), (payload) => {
    payload.android.readyDevices.push({ serial: 'android-ready-2' })
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical android runtime artifacts use the same device serial/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/android/flashlight-rn.json')
  rewriteJson(file, (payload) => {
    for (const iteration of payload.iterations) {
      iteration.measures = [{ fps: 45 }]
    }
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical android flashlight: average FPS 45\.00 >= 50/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/ios/runtime-summary.json')
  rewriteJson(file, (payload) => {
    payload.variants[1].environment.deviceIds = ['other-ios']
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical ios hakka repeated-run metadata device id is currently ready/)
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/ios/runtime-summary.json')
  rewriteJson(file, (payload) => {
    payload.variants[1].environment.collectedAts = ['not-a-timestamp']
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /physical ios hakka repeated-run metadata collection timestamp not-a-timestamp is a valid ISO timestamp/,
  )
})

withFixture((root) => {
  const file = path.join(root, 'artifacts/benchmarks/physical/ios/runtime-summary.json')
  rewriteJson(file, (payload) => {
    payload.variants[2].environment.deviceIds = ['ios-ready-2']
  })
  rewriteJson(path.join(root, 'readiness.json'), (payload) => {
    payload.ios.readyDevices.push({ id: 'ios-ready-2', name: 'iPhone 2' })
  })

  const result = runVerifier(root)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /physical ios repeated-run variants use the same device id/)
})

console.log('benchmark verifier fixture tests passed')
