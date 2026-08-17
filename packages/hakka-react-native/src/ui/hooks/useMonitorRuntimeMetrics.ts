import { Hakka } from 'hakka-core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cancelFrame, getHermesHeapBytes, monotonicNowMs, percentile, requestFrame } from '../utils/monitorRuntime'
import { coerceHealthReport, type JsRuntimeMetrics, type MonitorHealthInput } from '../utils/monitorSummary'

const MONITOR_POLL_INTERVAL_MS = 5000
const JS_LAG_SAMPLE_INTERVAL_MS = 1000
const JS_LAG_SAMPLE_WINDOW = 60

export interface MonitorRuntimeMetrics {
  healthReport: MonitorHealthInput | null
  jsRuntimeMetrics: JsRuntimeMetrics
  /** Wire to the root view's `onLayout` — measures cost-since-render-start. */
  handleLayoutMeasured: () => void
}

/**
 * Samples JS-thread health (event-loop lag, FPS, Hermes heap, layout/render
 * cost) and polls the native health report — both gated on `monitorActive`
 * so nothing samples while the monitor is hidden. Mirrors the timing block
 * that used to live inline in `HakkaInspector.tsx`'s `InspectorUI`.
 */
export function useMonitorRuntimeMetrics(monitorActive: boolean): MonitorRuntimeMetrics {
  const healthReportUnavailableRef = useRef(false)
  const renderStartMs = monotonicNowMs()
  const lagSamplesRef = useRef<number[]>([])
  const lastRenderCostUpdateMsRef = useRef(0)
  const [jsRuntimeMetrics, setJsRuntimeMetrics] = useState<JsRuntimeMetrics>({
    currentLagMs: null,
    p95LagMs: null,
    maxLagMs: null,
    sampleCount: 0,
    overlayRenderCostMs: null,
    jsFps: null,
    hermesHeapBytes: getHermesHeapBytes(),
    layoutCostMs: null,
    nativeHealthPollCostMs: null,
  })
  const [healthReport, setHealthReport] = useState<MonitorHealthInput | null>(null)

  const handleLayoutMeasured = useCallback(() => {
    const layoutCostMs = Math.max(0, monotonicNowMs() - renderStartMs)
    setJsRuntimeMetrics((previous) => {
      const rounded = Math.round(layoutCostMs)
      if (previous.layoutCostMs === rounded) return previous
      return { ...previous, layoutCostMs: rounded }
    })
  }, [renderStartMs])

  useLayoutEffect(() => {
    if (!monitorActive) return undefined
    const now = monotonicNowMs()
    if (now - lastRenderCostUpdateMsRef.current < JS_LAG_SAMPLE_INTERVAL_MS) {
      return undefined
    }
    lastRenderCostUpdateMsRef.current = now
    const renderCostMs = Math.max(0, monotonicNowMs() - renderStartMs)
    setJsRuntimeMetrics((previous) => {
      const rounded = Math.round(renderCostMs)
      if (previous.overlayRenderCostMs === rounded) return previous
      return { ...previous, overlayRenderCostMs: rounded }
    })
    return undefined
  }, [monitorActive, renderStartMs])

  useEffect(() => {
    if (!monitorActive) return undefined

    let frameCount = 0
    let frameId: number | null = null
    let expected = monotonicNowMs() + JS_LAG_SAMPLE_INTERVAL_MS
    let fpsWindowStart = monotonicNowMs()
    const tick = () => {
      frameCount += 1
      frameId = requestFrame(tick)
    }
    frameId = requestFrame(tick)
    const interval = setInterval(() => {
      const now = monotonicNowMs()
      const lagMs = Math.max(0, now - expected)
      expected = now + JS_LAG_SAMPLE_INTERVAL_MS
      const elapsedMs = Math.max(1, now - fpsWindowStart)
      const jsFps = frameCount > 0 ? Math.min(120, Math.round((frameCount * 1000) / elapsedMs)) : null
      frameCount = 0
      fpsWindowStart = now
      const samples = lagSamplesRef.current
      samples.push(lagMs)
      if (samples.length > JS_LAG_SAMPLE_WINDOW) {
        samples.splice(0, samples.length - JS_LAG_SAMPLE_WINDOW)
      }
      setJsRuntimeMetrics((previous) => ({
        ...previous,
        currentLagMs: Math.round(lagMs),
        p95LagMs: percentile(samples, 0.95),
        maxLagMs: samples.length > 0 ? Math.round(Math.max(...samples)) : null,
        sampleCount: samples.length,
        jsFps,
        hermesHeapBytes: getHermesHeapBytes(),
      }))
    }, JS_LAG_SAMPLE_INTERVAL_MS)

    return () => {
      clearInterval(interval)
      cancelFrame(frameId)
      lagSamplesRef.current = []
    }
  }, [monitorActive])

  useEffect(() => {
    if (!monitorActive || healthReportUnavailableRef.current) return undefined

    let cancelled = false

    const pollHealthReport = () => {
      if (cancelled) return

      const pollStartMs = monotonicNowMs()
      void Hakka.getHealthReport().then((report) => {
        if (cancelled) return

        const pollCostMs = Math.max(0, monotonicNowMs() - pollStartMs)
        setJsRuntimeMetrics((previous) => ({
          ...previous,
          nativeHealthPollCostMs: Math.round(pollCostMs),
        }))

        const parsed = coerceHealthReport(report)
        if (parsed) {
          setHealthReport(parsed)
        } else if (report === undefined) {
          healthReportUnavailableRef.current = true
        }
      })
    }

    pollHealthReport()
    const interval = setInterval(pollHealthReport, MONITOR_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [monitorActive, healthReportUnavailableRef])

  return { healthReport, jsRuntimeMetrics, handleLayoutMeasured }
}
