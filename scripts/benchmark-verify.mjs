#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDeviceReadiness } from './device-readiness.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = process.env.HAKKA_BENCHMARK_ROOT
  ? path.resolve(process.env.HAKKA_BENCHMARK_ROOT)
  : path.resolve(scriptDir, '..')
const jsonMode = process.argv.includes('--json')
const strictPhysicalMode = process.argv.includes('--strict-physical')
const baselineOverheadBudget = 0.05
const baselineOverheadLabel = '5%'

const result = {
  generatedAt: new Date().toISOString(),
  root,
  passed: [],
  warnings: [],
  failed: [],
}

function relPath(relativePath) {
  return path.join(root, relativePath)
}

function readJson(relativePath, options = {}) {
  const fullPath = relPath(relativePath)
  if (!fs.existsSync(fullPath)) {
    if (options.optional) return null
    fail(`missing artifact: ${relativePath}`)
    return null
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function percentDelta(value, baseline) {
  return ((value - baseline) / baseline) * 100
}

function pass(message) {
  result.passed.push(message)
}

function warn(message) {
  result.warnings.push(message)
}

function physicalGap(message) {
  if (strictPhysicalMode) {
    fail(message)
  } else {
    warn(message)
  }
}

function fail(message) {
  result.failed.push(message)
}

function assert(condition, message) {
  if (condition) {
    pass(message)
  } else {
    fail(message)
  }
}

function assertRuntime(runtime, label, minCount = 100) {
  const summary = runtime?.summary ?? {}
  const count = number(summary.count)
  const success = number(summary.successCount)
  const failure = number(summary.failureCount)
  assert(count >= minCount, `${label}: count ${count} >= ${minCount}`)
  assert(success === count, `${label}: success ${success} == count ${count}`)
  assert(failure === 0, `${label}: failure count is 0`)
}

function assertHakkaInspector(inspector, summary, label) {
  assert(number(inspector.capturedRecords) === number(summary.count), `${label} captured every request`)
  assert(number(inspector.droppedSinkRecords) === 0, `${label} dropped 0 sink records`)
  if (String(inspector.performanceEnabled) === 'false') {
    pass(`${label} network benchmark runs without performance collectors`)
  } else {
    assert(String(inspector.performanceRunning) === 'true', `${label} performance collectors are running`)
    assert(number(inspector.performanceSampleIntervalMs) >= 1000, `${label} sample interval is clamped to >= 1000ms`)
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function uniqueValues(values) {
  return [...new Set(values.filter(nonEmptyString))]
}

function isValidIsoTimestamp(value) {
  if (!nonEmptyString(value)) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return new Date(parsed).toISOString() === value
}

function assertIsoTimestamp(value, label) {
  assert(isValidIsoTimestamp(value), `${label} is a valid ISO timestamp`)
}

function assertIsoTimestampList(values, label) {
  assert(Array.isArray(values) && values.length > 0, `${label} includes collection timestamps`)
  if (!Array.isArray(values)) return
  for (const value of values) {
    assertIsoTimestamp(value, `${label} collection timestamp ${value}`)
  }
}

function assertPhysicalEnvironment(environment, platform, label, options = {}) {
  assert(Boolean(environment), `${label} includes physical-target metadata`)
  if (!environment) return
  assert(environment.platform === platform, `${label} metadata platform is ${platform}`)
  assert(environment.targetKind === 'physical', `${label} metadata target is physical`)
  assert(nonEmptyString(environment.collectedAt), `${label} metadata includes collection timestamp`)
  assertIsoTimestamp(environment.collectedAt, `${label} metadata collection timestamp`)
  if (options.runner) {
    assert(environment.runner === options.runner, `${label} metadata runner is ${options.runner}`)
  }
  if (platform === 'android') {
    assert(nonEmptyString(environment.deviceSerial), `${label} metadata includes Android device serial`)
    if (options.readyDeviceSerials) {
      assert(
        options.readyDeviceSerials.includes(environment.deviceSerial),
        `${label} metadata device serial is currently ready`,
      )
    }
  }
  if (platform === 'ios') {
    assert(nonEmptyString(environment.deviceId), `${label} metadata includes iOS device id`)
    if (options.readyDeviceIds) {
      assert(options.readyDeviceIds.includes(environment.deviceId), `${label} metadata device id is currently ready`)
    }
  }
}

function assertPhysicalSummaryEnvironment(row, platform, label, options = {}) {
  const environment = row.environment
  assert(Boolean(environment), `${label} repeated-run summary includes physical-target metadata`)
  if (!environment) return
  assert(
    Array.isArray(environment.platforms) && environment.platforms.length === 1 && environment.platforms[0] === platform,
    `${label} repeated-run metadata platform is ${platform}`,
  )
  assert(
    Array.isArray(environment.targetKinds) &&
      environment.targetKinds.length === 1 &&
      environment.targetKinds[0] === 'physical',
    `${label} repeated-run metadata target is physical`,
  )
  assertIsoTimestampList(environment.collectedAts, `${label} repeated-run metadata`)
  if (options.runner) {
    assert(
      Array.isArray(environment.runners) &&
        environment.runners.length === 1 &&
        environment.runners[0] === options.runner,
      `${label} repeated-run metadata runner is ${options.runner}`,
    )
  }
  if (platform === 'ios') {
    assert(
      Array.isArray(environment.deviceIds) && environment.deviceIds.some(nonEmptyString),
      `${label} repeated-run metadata includes iOS device id`,
    )
    if (options.readyDeviceIds) {
      const deviceIds = uniqueValues(Array.isArray(environment.deviceIds) ? environment.deviceIds : [])
      assert(
        deviceIds.length > 0 && deviceIds.every((deviceId) => options.readyDeviceIds.includes(deviceId)),
        `${label} repeated-run metadata device id is currently ready`,
      )
    }
  }
}

function assertFlashlightPayload(payload, label, options = {}) {
  const iterations = Array.isArray(payload.iterations) ? payload.iterations : []
  const successful = iterations.filter((iteration) => iteration.status === 'SUCCESS')
  const samples = successful.flatMap((iteration) => (Array.isArray(iteration.measures) ? iteration.measures : []))
  const fps = samples.map((sample) => number(sample.fps)).filter(Number.isFinite)
  const avgFps = fps.reduce((sum, value) => sum + value, 0) / fps.length

  assert(iterations.length >= 10, `${label}: iteration count ${iterations.length} >= 10`)
  assert(successful.length === iterations.length, `${label}: all iterations succeeded`)
  assert(samples.length > 0, `${label}: ${samples.length} samples recorded`)
  if (Number.isFinite(avgFps) && avgFps >= 50) {
    pass(`${label}: average FPS ${avgFps.toFixed(2)} >= 50`)
  } else if (options.requireAverageFps) {
    fail(`${label}: average FPS ${Number.isFinite(avgFps) ? avgFps.toFixed(2) : 'n/a'} >= 50`)
  } else {
    warn(`${label}: average FPS ${Number.isFinite(avgFps) ? avgFps.toFixed(2) : 'n/a'} below 50`)
  }
}

function sizeRow(payload, variant, buildType) {
  return payload.rows.find((row) => row.variant === variant && row.buildType === buildType)
}

function iosSizeRow(payload, variant, configuration) {
  return payload.rows.find((row) => row.variant === variant && row.configuration === configuration)
}

function verifyAndroid() {
  const baseline = readJson('artifacts/benchmarks/android/baseline-runtime.json')
  const hakka = readJson('artifacts/benchmarks/android/hakka-runtime.json')
  const chucker = readJson('artifacts/benchmarks/android/chucker-runtime.json')
  const sizes = readJson('artifacts/benchmarks/android/apk-sizes.json')
  if (!baseline || !hakka || !chucker || !sizes) return

  assertRuntime(baseline, 'android baseline')
  assertRuntime(hakka, 'android hakka')
  assertRuntime(chucker, 'android chucker')

  const baselineAvg = number(baseline.summary.averageDurationMs)
  const hakkaAvg = number(hakka.summary.averageDurationMs)
  const chuckerAvg = number(chucker.summary.averageDurationMs)
  const avgDelta = percentDelta(hakkaAvg, baselineAvg)

  assert(
    hakkaAvg <= baselineAvg * (1 + baselineOverheadBudget),
    `android hakka average ${hakkaAvg.toFixed(2)}ms within ${baselineOverheadLabel} of baseline ${baselineAvg.toFixed(2)}ms (${avgDelta.toFixed(1)}%)`,
  )
  assert(
    hakkaAvg < chuckerAvg,
    `android hakka average ${hakkaAvg.toFixed(2)}ms faster than chucker ${chuckerAvg.toFixed(2)}ms`,
  )

  assertHakkaInspector(hakka.inspector ?? {}, hakka.summary ?? {}, 'android hakka')

  const baselineRelease = sizeRow(sizes, 'baseline', 'release')
  const hakkaRelease = sizeRow(sizes, 'hakka', 'release')
  const chuckerDebug = sizeRow(sizes, 'chucker', 'debug')
  const hakkaDebug = sizeRow(sizes, 'hakka', 'debug')
  assert(Boolean(baselineRelease && hakkaRelease), 'android release size rows exist for baseline and hakka')
  if (baselineRelease && hakkaRelease) {
    // Same 180 KB base-SDK budget the size gate enforces — keep the two in
    // sync (`scripts/android-size-gate.sh` `BUDGET_BYTES`, which carries the
    // derivation). The two harnesses measure the delta independently and now
    // agree within noise (~149 KB vs ~152 KB), so one budget covers both.
    const releaseDelta = hakkaRelease.bytes - baselineRelease.bytes
    assert(releaseDelta <= 184320, `android hakka release delta ${releaseDelta} bytes <= 184320 byte base SDK budget`)
  }
  if (chuckerDebug && hakkaDebug) {
    assert(hakkaDebug.bytes < chuckerDebug.bytes, 'android hakka debug APK is smaller than chucker debug APK')
  }
}

function verifyIos() {
  const baseline = readJson('artifacts/benchmarks/ios/baseline-runtime.json')
  const hakka = readJson('artifacts/benchmarks/ios/hakka-runtime.json')
  const wormholy = readJson('artifacts/benchmarks/ios/wormholy-runtime.json')
  const pulse = readJson('artifacts/benchmarks/ios/pulse-runtime.json')
  const sizes = readJson('artifacts/benchmarks/ios/app-sizes.json')
  const runtimeSummary = readJson('artifacts/benchmarks/ios/runtime-summary.json', { optional: true })
  if (!baseline || !hakka || !wormholy || !pulse || !sizes) return

  assertRuntime(baseline, 'ios baseline')
  assertRuntime(hakka, 'ios hakka')
  assertRuntime(wormholy, 'ios wormholy')
  assertRuntime(pulse, 'ios pulse')

  const baselineAvg = number(baseline.summary.averageDurationMs)
  const hakkaAvg = number(hakka.summary.averageDurationMs)
  const wormholyAvg = number(wormholy.summary.averageDurationMs)
  const pulseAvg = number(pulse.summary.averageDurationMs)
  const avgDelta = percentDelta(hakkaAvg, baselineAvg)
  const hasRepeatedSummary = hasCompleteIosRuntimeSummary(runtimeSummary)

  assert(
    hakkaAvg < wormholyAvg,
    `ios hakka latest average ${hakkaAvg.toFixed(2)}ms faster than wormholy ${wormholyAvg.toFixed(2)}ms`,
  )
  if (hakkaAvg <= baselineAvg * (1 + baselineOverheadBudget)) {
    pass(`ios hakka latest average within ${baselineOverheadLabel} of baseline (${avgDelta.toFixed(1)}%)`)
  } else if (!hasRepeatedSummary) {
    warn(
      `ios latest single run is ${avgDelta.toFixed(1)}% over baseline; use repeated-run mean target until the harness writes aggregate JSON`,
    )
  }
  if (hakkaAvg <= pulseAvg) {
    pass(`ios hakka latest average ${hakkaAvg.toFixed(2)}ms <= pulse ${pulseAvg.toFixed(2)}ms`)
  } else if (!hasRepeatedSummary) {
    warn(
      `ios latest single run has hakka ${hakkaAvg.toFixed(2)}ms slightly above pulse ${pulseAvg.toFixed(2)}ms; repeated-run mean currently favors hakka`,
    )
  }
  verifyIosRuntimeSummary(runtimeSummary)

  assertHakkaInspector(hakka.inspector ?? {}, hakka.summary ?? {}, 'ios hakka')

  const hakkaDebug = iosSizeRow(sizes, 'BenchmarkHakka', 'Debug')
  const wormholyDebug = iosSizeRow(sizes, 'BenchmarkWormholy', 'Debug')
  const pulseDebug = iosSizeRow(sizes, 'BenchmarkPulse', 'Debug')
  const hakkaRelease = iosSizeRow(sizes, 'BenchmarkHakka', 'Release')
  assert(Boolean(hakkaDebug && wormholyDebug && pulseDebug), 'ios debug size rows exist for hakka, wormholy, and pulse')
  if (hakkaDebug && wormholyDebug && pulseDebug) {
    assert(hakkaDebug.bytes < wormholyDebug.bytes, 'ios hakka debug app is smaller than wormholy debug app')
    assert(hakkaDebug.bytes < pulseDebug.bytes, 'ios hakka debug app is smaller than pulse debug app')
  }
  if (hakkaRelease) {
    pass('ios hakka release size row exists')
  } else {
    warn(
      'ios hakka release size row missing; rerun benchmark:ios:competitors with release builds enabled for release-size validation',
    )
  }
}

function hasCompleteIosRuntimeSummary(summary) {
  if (!summary || !Array.isArray(summary.variants)) return false
  const rows = new Map(summary.variants.map((variant) => [variant.variant, variant]))
  return ['baseline', 'hakka', 'wormholy', 'pulse'].every((variant) => {
    const row = rows.get(variant)
    return row?.runs >= 3 && Number.isFinite(number(row.meanAverageDurationMs))
  })
}

function verifyIosRuntimeSummary(summary) {
  verifyIosRuntimeSummaryWithLabel(summary, 'ios')
}

function verifyIosRuntimeSummaryWithLabel(summary, label) {
  if (!summary) {
    warn(`${label} repeated-run summary is missing; run each iOS variant at least 3 times`)
    return
  }

  const rows = new Map(summary.variants.map((variant) => [variant.variant, variant]))
  const required = ['baseline', 'hakka', 'wormholy', 'pulse']
  const missing = required.filter((variant) => !rows.has(variant))
  assert(missing.length === 0, `${label} repeated-run summary has baseline, hakka, wormholy, and pulse`)
  if (missing.length > 0) return

  for (const variant of required) {
    const row = rows.get(variant)
    assert(row.runs >= 3, `${label} ${variant} repeated-run summary has at least 3 runs`)
    assert(row.countPerRun >= 100, `${label} ${variant} repeated-run count is >= 100`)
    assert(row.successPerRun === row.countPerRun, `${label} ${variant} repeated-run success matches count`)
    assert(row.maxFailureCount === 0, `${label} ${variant} repeated-run failure count is 0`)
  }

  const baseline = rows.get('baseline')
  const hakka = rows.get('hakka')
  const wormholy = rows.get('wormholy')
  const pulse = rows.get('pulse')
  const delta = percentDelta(hakka.meanAverageDurationMs, baseline.meanAverageDurationMs)

  assert(
    hakka.meanAverageDurationMs <= baseline.meanAverageDurationMs * (1 + baselineOverheadBudget),
    `${label} hakka repeated-run mean ${hakka.meanAverageDurationMs.toFixed(2)}ms within ${baselineOverheadLabel} of baseline ${baseline.meanAverageDurationMs.toFixed(2)}ms (${delta.toFixed(1)}%)`,
  )
  assert(
    hakka.meanAverageDurationMs < wormholy.meanAverageDurationMs,
    `${label} hakka repeated-run mean ${hakka.meanAverageDurationMs.toFixed(2)}ms faster than wormholy ${wormholy.meanAverageDurationMs.toFixed(2)}ms`,
  )
  assert(
    hakka.meanAverageDurationMs <= pulse.meanAverageDurationMs,
    `${label} hakka repeated-run mean ${hakka.meanAverageDurationMs.toFixed(2)}ms <= pulse ${pulse.meanAverageDurationMs.toFixed(2)}ms`,
  )

  const inspector = hakka.inspector
  assert(Boolean(inspector), `${label} hakka repeated-run summary includes inspector health`)
  if (inspector) {
    assert(
      number(inspector.minCapturedRecords) >= number(hakka.countPerRun),
      `${label} hakka repeated-run captured every request`,
    )
    assert(number(inspector.maxDroppedSinkRecords) === 0, `${label} hakka repeated-run dropped 0 sink records`)
    if (inspector.allPerformanceEnabled === false || inspector.allPerformanceRunning === false) {
      pass(`${label} hakka repeated-run network benchmark runs without performance collectors`)
    } else {
      assert(inspector.allPerformanceRunning === true, `${label} hakka repeated-run performance collectors are running`)
      assert(
        number(inspector.minPerformanceSampleIntervalMs) >= 1000,
        `${label} hakka repeated-run sample interval is clamped to >= 1000ms`,
      )
    }
  }
}

function verifyReactNativeModes() {
  const payload = readJson('artifacts/benchmarks/rn/modes-runtime.json')
  if (!payload) return
  const rows = new Map(payload.rows.map((row) => [row.name, row]))
  const expected = [
    ['native', true],
    ['js', false],
    ['auto-native', true],
    ['auto-fallback', false],
  ]

  for (const [name, shouldBeNative] of expected) {
    const row = rows.get(name)
    assert(Boolean(row), `rn mode ${name}: row exists`)
    if (!row) continue
    assert(row.capturedRecords === row.requestedCount, `rn mode ${name}: captured every logical request`)
    assert(row.uniqueRecordIds === row.requestedCount, `rn mode ${name}: all record ids are unique`)
    assert(row.duplicateRecords === 0, `rn mode ${name}: duplicate records are 0`)
    if (shouldBeNative) {
      assert(row.nativeRecords === row.requestedCount && row.jsRecords === 0, `rn mode ${name}: native-only capture`)
    } else {
      assert(row.nativeRecords === 0 && row.jsRecords === row.requestedCount, `rn mode ${name}: js-only capture`)
    }
  }
}

function verifyFlashlight() {
  const payload = readJson('artifacts/flashlight-rn-android-10iter.json', { optional: true })
  if (!payload) {
    warn('flashlight 10-iteration artifact is missing; skipping RN Android UI frame-health gate')
    return
  }

  assertFlashlightPayload(payload, 'flashlight')
}

const deviceReadiness = getDeviceReadiness()

verifyAndroid()
verifyIos()
verifyReactNativeModes()
verifyFlashlight()
verifyDeviceReadiness(deviceReadiness)
if (strictPhysicalMode) verifyPhysicalArtifacts(deviceReadiness)

function verifyDeviceReadiness(readiness) {
  if (readiness.android.ready) {
    pass(`physical Android device ready: ${readiness.android.readyDevices.map((device) => device.serial).join(', ')}`)
  } else if (!readiness.android.commandAvailable) {
    physicalGap('physical Android runtime and Flashlight repeat are open: adb is unavailable')
  } else {
    physicalGap(
      'physical Android runtime and Flashlight repeat are open: no adb device is attached in the current local state',
    )
  }

  if (readiness.ios.ready) {
    pass(`physical iOS device ready: ${readiness.ios.readyDevices.map((device) => device.name).join(', ')}`)
  } else if (!readiness.ios.commandAvailable) {
    physicalGap('physical iOS runtime and long-session frame health are open: xcrun xctrace is unavailable')
  } else {
    const offline = readiness.ios.offlineDevices.map((device) => `${device.name} (${device.osVersion})`).join(', ')
    physicalGap(
      offline
        ? `physical iOS runtime and long-session frame health are open: offline devices ${offline}`
        : 'physical iOS runtime and long-session frame health are open: no physical iOS device is attached',
    )
  }
}

function readPhysicalJson(relativePath) {
  return readJson(`artifacts/benchmarks/physical/${relativePath}`)
}

function verifyPhysicalArtifacts(readiness) {
  const androidBaseline = readPhysicalJson('android/baseline-runtime.json')
  const androidHakka = readPhysicalJson('android/hakka-runtime.json')
  const androidChucker = readPhysicalJson('android/chucker-runtime.json')
  const androidFlashlight = readPhysicalJson('android/flashlight-rn.json')
  const iosSummary = readPhysicalJson('ios/runtime-summary.json')
  const readyAndroidSerials = readiness.android.readyDevices.map((device) => device.serial)
  const readyIosDeviceIds = readiness.ios.readyDevices.map((device) => device.id)

  if (androidBaseline && androidHakka && androidChucker) {
    assertRuntime(androidBaseline, 'physical android baseline')
    assertRuntime(androidHakka, 'physical android hakka')
    assertRuntime(androidChucker, 'physical android chucker')
    assertPhysicalEnvironment(androidBaseline.environment, 'android', 'physical android baseline', {
      runner: 'android-physical-benchmark',
      readyDeviceSerials: readyAndroidSerials,
    })
    assertPhysicalEnvironment(androidHakka.environment, 'android', 'physical android hakka', {
      runner: 'android-physical-benchmark',
      readyDeviceSerials: readyAndroidSerials,
    })
    assertPhysicalEnvironment(androidChucker.environment, 'android', 'physical android chucker', {
      runner: 'android-physical-benchmark',
      readyDeviceSerials: readyAndroidSerials,
    })
    const runtimeSerials = uniqueValues([
      androidBaseline.environment?.deviceSerial,
      androidHakka.environment?.deviceSerial,
      androidChucker.environment?.deviceSerial,
    ])
    assert(runtimeSerials.length === 1, 'physical android runtime artifacts use the same device serial')
    assertHakkaInspector(androidHakka.inspector ?? {}, androidHakka.summary ?? {}, 'physical android hakka')

    const baselineAvg = number(androidBaseline.summary.averageDurationMs)
    const hakkaAvg = number(androidHakka.summary.averageDurationMs)
    const chuckerAvg = number(androidChucker.summary.averageDurationMs)
    const delta = percentDelta(hakkaAvg, baselineAvg)
    assert(
      hakkaAvg <= baselineAvg * (1 + baselineOverheadBudget),
      `physical android hakka average ${hakkaAvg.toFixed(2)}ms within ${baselineOverheadLabel} of baseline ${baselineAvg.toFixed(2)}ms (${delta.toFixed(1)}%)`,
    )
    assert(
      hakkaAvg < chuckerAvg,
      `physical android hakka average ${hakkaAvg.toFixed(2)}ms faster than chucker ${chuckerAvg.toFixed(2)}ms`,
    )
  }

  if (androidFlashlight) {
    assertPhysicalEnvironment(androidFlashlight.environment, 'android', 'physical android flashlight', {
      runner: 'android-physical-benchmark',
      readyDeviceSerials: readyAndroidSerials,
    })
    const runtimeSerial = androidHakka?.environment?.deviceSerial
    if (nonEmptyString(runtimeSerial)) {
      assert(
        androidFlashlight.environment?.deviceSerial === runtimeSerial,
        'physical android flashlight artifact uses the runtime benchmark device serial',
      )
    }
    assertFlashlightPayload(androidFlashlight, 'physical android flashlight', { requireAverageFps: true })
  }

  if (iosSummary) {
    verifyIosRuntimeSummaryWithLabel(iosSummary, 'physical ios')
    const rows = new Map(iosSummary.variants.map((variant) => [variant.variant, variant]))
    for (const variant of ['baseline', 'hakka', 'wormholy', 'pulse']) {
      const row = rows.get(variant)
      if (row) {
        assertPhysicalSummaryEnvironment(row, 'ios', `physical ios ${variant}`, {
          runner: 'ios-physical-run',
          readyDeviceIds: readyIosDeviceIds,
        })
      }
    }
    const summaryDeviceIds = uniqueValues(
      ['baseline', 'hakka', 'wormholy', 'pulse'].flatMap((variant) => rows.get(variant)?.environment?.deviceIds ?? []),
    )
    assert(summaryDeviceIds.length === 1, 'physical ios repeated-run variants use the same device id')
  }
}

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const message of result.passed) console.log(`PASS ${message}`)
  for (const message of result.warnings) console.warn(`WARN ${message}`)
  for (const message of result.failed) console.error(`FAIL ${message}`)
  console.log(
    `\nbenchmark verification: ${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failed.length} failed`,
  )
}

if (result.failed.length > 0) {
  process.exit(1)
}
