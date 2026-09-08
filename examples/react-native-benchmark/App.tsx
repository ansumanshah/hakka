import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native'

import { getRuntime, writeResult } from './src/BenchmarkRuntime'
import { getHakkaCaptures, showHakkaInspector, startHakkaCapture } from './src/InspectorCapture'

declare const performance: { now(): number }

type Variant = 'baseline' | 'hakka' | 'chucker' | 'pulse' | 'wormholy'

interface Sample {
  durationMs: number
  lagMs: number
}

interface Result {
  schemaVersion: 1
  variant: Variant
  platform: string
  requestedCount: number
  completedCount: number
  capturedCount: number | null
  bodyMode: string
  samples: Sample[]
  summary: {
    medianMs: number
    p95Ms: number
    medianJsLagMs: number
    p95JsLagMs: number
  }
  environment: Record<string, string | number | boolean | null>
}

const requestCount = 100
const bodySizes = [0, 256, 16_384] as const

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))]
}

async function measuredRequest(url: string, index: number): Promise<Sample> {
  const bodySize = bodySizes[index % bodySizes.length]
  const startedAt = performance.now()
  let callbackAt = startedAt
  const callback = new Promise<void>((resolve) => {
    setTimeout(() => {
      callbackAt = performance.now()
      resolve()
    }, 0)
  })
  const requestUrl = `${url}/payload/${bodySize}?i=${index}`
  let completedAt: number
  if (index % 2 === 0) {
    const response = await fetch(requestUrl, { headers: { 'x-hakka-rn-benchmark': '1' } })
    if (response.status !== 200) throw new Error(`Fetch status ${response.status}`)
    const body = await response.arrayBuffer()
    if (body.byteLength !== bodySize)
      throw new Error(`Fetch body mismatch: expected ${bodySize}, received ${body.byteLength}`)
    completedAt = performance.now()
  } else {
    completedAt = await new Promise<number>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('GET', requestUrl)
      request.responseType = 'arraybuffer'
      request.setRequestHeader('x-hakka-rn-benchmark', '1')
      request.onload = () => {
        const length = request.response instanceof ArrayBuffer ? request.response.byteLength : -1
        if (request.status !== 200) reject(new Error(`XHR status ${request.status}`))
        else if (length !== bodySize) reject(new Error(`XHR body mismatch: expected ${bodySize}, received ${length}`))
        else resolve(performance.now())
      }
      request.onerror = () => reject(new Error('XHR failed'))
      request.send()
    })
  }
  await callback
  return { durationMs: completedAt - startedAt, lagMs: Math.max(0, callbackAt - startedAt) }
}

function validateHakkaCaptures(logs: Array<{ url: string; responseBody?: string | null; responseBodySize?: number }>) {
  for (const log of logs) {
    const match = log.url.match(/\/payload\/(0|256|16384)(?:\?|$)/)
    if (!match) continue
    const expectedSize = Number(match[1])
    if (log.responseBodySize !== expectedSize) {
      throw new Error(
        `Hakka retained size mismatch: expected ${expectedSize}, received ${String(log.responseBodySize)}`,
      )
    }
    const actualBody = log.responseBody ?? ''
    if (actualBody !== 'x'.repeat(expectedSize)) {
      throw new Error(`Hakka retained body mismatch: expected ${expectedSize} bytes, received ${actualBody.length}`)
    }
  }
}

export default function App() {
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const didAutoRun = useRef(false)
  const runtime = useMemo(() => getRuntime(), [])

  const run = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    try {
      if (runtime.variant === 'hakka') {
        startHakkaCapture(requestCount + 10)
      }
      const samples: Sample[] = []
      for (let index = 0; index < requestCount; index += 1) {
        // Serial fetch/XHR requests keep each capture on the measured critical path.
        // eslint-disable-next-line no-await-in-loop
        samples.push(await measuredRequest(runtime.serverUrl, index))
      }
      let hakkaLogs = getHakkaCaptures()
      let capturedCount = hakkaLogs?.length ?? (await runtime.getCapturedCount())
      for (let attempt = 0; capturedCount !== null && capturedCount !== requestCount && attempt < 50; attempt += 1) {
        // Native persistence can finish shortly after the JS response resolves.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
        hakkaLogs = getHakkaCaptures()
        // eslint-disable-next-line no-await-in-loop
        capturedCount = hakkaLogs?.length ?? (await runtime.getCapturedCount())
      }
      if (hakkaLogs) validateHakkaCaptures(hakkaLogs)
      if (capturedCount !== null && capturedCount !== requestCount) {
        throw new Error(`Capture mismatch: expected ${requestCount}, received ${capturedCount}`)
      }
      const durations = samples.map((sample) => sample.durationMs)
      const lag = samples.map((sample) => sample.lagMs)
      const next: Result = {
        schemaVersion: 1,
        variant: runtime.variant,
        platform: runtime.platform,
        requestedCount: requestCount,
        completedCount: samples.length,
        capturedCount,
        bodyMode: 'response bodies: 0 B, 256 B, and 16 KiB round-robin',
        samples,
        summary: {
          medianMs: percentile(durations, 0.5),
          p95Ms: percentile(durations, 0.95),
          medianJsLagMs: percentile(lag, 0.5),
          p95JsLagMs: percentile(lag, 0.95),
        },
        environment: await runtime.getEnvironment(),
      }
      setResult(next)
      await writeResult(next)
      if (runtime.variant === 'hakka' && runtime.showUI) await showHakkaInspector()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      try {
        await writeResult({ schemaVersion: 1, variant: runtime.variant, platform: runtime.platform, error: message })
      } catch (writeError) {
        setError(`${message}; result write failed: ${String(writeError)}`)
      }
    } finally {
      setIsRunning(false)
    }
  }, [runtime])

  useEffect(() => {
    if (!runtime.autoRun || didAutoRun.current) return
    didAutoRun.current = true
    void run()
  }, [run, runtime.autoRun])

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>RN inspector benchmark</Text>
        <Text testID="benchmark-variant">{runtime.variant}</Text>
        <Text style={styles.copy}>
          100 serial JS fetch/XHR requests against the local fixture. Responses rotate through 0 B, 256 B, and 16 KiB.
        </Text>
        <Button title={isRunning ? 'Running…' : 'Run benchmark'} disabled={isRunning} onPress={() => void run()} />
        {error ? (
          <Text style={styles.error} testID="benchmark-error">
            {error}
          </Text>
        ) : null}
        {result ? (
          <Text selectable style={styles.result} testID="benchmark-result">
            {JSON.stringify(result)}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { gap: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '700' },
  copy: { color: '#555', lineHeight: 20 },
  error: { color: '#b42318' },
  result: { fontFamily: 'Menlo', fontSize: 11 },
})
