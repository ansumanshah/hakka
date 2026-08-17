#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const [command, firstFile, secondFile, thirdFile] = process.argv.slice(2)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null
}

function booleanTrue(value) {
  return value === true || value === 'true'
}

function summarize(history) {
  const runs = Array.isArray(history.runs) ? history.runs : []
  const byVariant = new Map()

  for (const run of runs) {
    const variant = run.variant
    if (!variant) continue
    const rows = byVariant.get(variant) ?? []
    rows.push(run)
    byVariant.set(variant, rows)
  }

  const variants = [...byVariant.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([variant, rows]) => {
      const averages = rows.map((row) => number(row.summary?.averageDurationMs)).filter(Number.isFinite)
      const rps = rows.map((row) => number(row.summary?.requestsPerSecond)).filter(Number.isFinite)
      const count = rows.map((row) => number(row.summary?.count)).filter(Number.isFinite)
      const success = rows.map((row) => number(row.summary?.successCount)).filter(Number.isFinite)
      const failure = rows.map((row) => number(row.summary?.failureCount)).filter(Number.isFinite)
      const inspectorRows = rows.map((row) => row.inspector).filter(Boolean)
      const environmentRows = rows.map((row) => row.environment).filter(Boolean)
      const captured = inspectorRows.map((inspector) => number(inspector.capturedRecords)).filter(Number.isFinite)
      const dropped = inspectorRows.map((inspector) => number(inspector.droppedSinkRecords)).filter(Number.isFinite)
      const sampleInterval = inspectorRows
        .map((inspector) => number(inspector.performanceSampleIntervalMs))
        .filter(Number.isFinite)
      const totalAverageMs = averages.reduce((sum, value) => sum + value, 0)
      const totalRps = rps.reduce((sum, value) => sum + value, 0)

      return {
        variant,
        runs: rows.length,
        countPerRun: count.length > 0 ? Math.min(...count) : null,
        successPerRun: success.length > 0 ? Math.min(...success) : null,
        maxFailureCount: failure.length > 0 ? Math.max(...failure) : null,
        meanAverageDurationMs: round(totalAverageMs / averages.length, 2),
        meanRequestsPerSecond: round(totalRps / rps.length, 2),
        samples: averages.map((value) => round(value, 2)),
        inspector:
          inspectorRows.length > 0
            ? {
                minCapturedRecords: captured.length > 0 ? Math.min(...captured) : null,
                maxDroppedSinkRecords: dropped.length > 0 ? Math.max(...dropped) : null,
                allPerformanceRunning: inspectorRows.every((inspector) => booleanTrue(inspector.performanceRunning)),
                minPerformanceSampleIntervalMs: sampleInterval.length > 0 ? Math.min(...sampleInterval) : null,
              }
            : null,
        environment:
          environmentRows.length > 0
            ? {
                targetKinds: [...new Set(environmentRows.map((environment) => environment.targetKind).filter(Boolean))],
                platforms: [...new Set(environmentRows.map((environment) => environment.platform).filter(Boolean))],
                deviceIds: [...new Set(environmentRows.map((environment) => environment.deviceId).filter(Boolean))],
                runners: [...new Set(environmentRows.map((environment) => environment.runner).filter(Boolean))],
                collectedAts: [
                  ...new Set(environmentRows.map((environment) => environment.collectedAt).filter(Boolean)),
                ],
              }
            : null,
      }
    })

  const summaryByVariant = new Map(variants.map((variant) => [variant.variant, variant]))
  const baseline = summaryByVariant.get('baseline')
  const hakka = summaryByVariant.get('hakka')
  const wormholy = summaryByVariant.get('wormholy')
  const pulse = summaryByVariant.get('pulse')
  const required = [baseline, hakka, wormholy, pulse]
  const minimumRunsPerVariant = 3

  const comparisons =
    required.every(Boolean) && required.every((variant) => Number.isFinite(variant.meanAverageDurationMs))
      ? {
          minimumRunsPerVariant,
          hasRequiredVariants: true,
          requiredVariantsHaveEnoughRuns: required.every((variant) => variant.runs >= minimumRunsPerVariant),
          allRunsSuccessful: required.every(
            (variant) =>
              variant.countPerRun >= 100 &&
              variant.successPerRun === variant.countPerRun &&
              variant.maxFailureCount === 0,
          ),
          hakkaBaselineDeltaPercent: round(
            ((hakka.meanAverageDurationMs - baseline.meanAverageDurationMs) / baseline.meanAverageDurationMs) * 100,
            1,
          ),
          hakkaWithinBaseline5Percent: hakka.meanAverageDurationMs <= baseline.meanAverageDurationMs * 1.05,
          hakkaFasterThanWormholy: hakka.meanAverageDurationMs < wormholy.meanAverageDurationMs,
          hakkaFasterOrEqualPulse: hakka.meanAverageDurationMs <= pulse.meanAverageDurationMs,
        }
      : {
          minimumRunsPerVariant,
          hasRequiredVariants: false,
        }

  return {
    generatedAt: new Date().toISOString(),
    sourceHistory: history.sourceHistory ?? null,
    runs: runs.length,
    variants,
    comparisons,
  }
}

if (command === 'append') {
  const resultFile = firstFile
  const historyFile = secondFile
  const summaryFile = thirdFile
  if (!resultFile || !historyFile || !summaryFile) {
    fail('Usage: ios-runtime-summary.mjs append <result.json> <history.json> <summary.json>')
  }

  const result = readJson(resultFile)
  if (!result) fail(`Missing result file: ${resultFile}`)

  const history = readJson(historyFile, {
    generatedAt: new Date().toISOString(),
    sourceHistory: historyFile,
    runs: [],
  })
  const run = {
    recordedAt: new Date().toISOString(),
    resultFile,
    variant: result.variant,
    url: result.url,
    summary: result.summary,
    inspector: result.inspector,
    environment: result.environment,
  }
  history.updatedAt = run.recordedAt
  history.runs.push(run)
  writeJson(historyFile, history)
  writeJson(summaryFile, summarize(history))
  process.exit(0)
}

if (command === 'summarize') {
  const historyFile = firstFile
  const summaryFile = secondFile
  if (!historyFile || !summaryFile) {
    fail('Usage: ios-runtime-summary.mjs summarize <history.json> <summary.json>')
  }
  const history = readJson(historyFile)
  if (!history) fail(`Missing history file: ${historyFile}`)
  writeJson(summaryFile, summarize(history))
  process.exit(0)
}

fail('Usage: ios-runtime-summary.mjs append|summarize ...')
