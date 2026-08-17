import type { NetworkRequest } from 'hakka-core'

import { coerceHealthReport, createMonitorHudModel, createMonitorSummary } from '../../src/ui/utils/monitorSummary'

function request(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: overrides.id ?? `req-${Math.random()}`,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? 'https://api.example.com/users',
    startTime: overrides.startTime ?? 1000,
    timestamp: overrides.timestamp ?? 1000,
    ...overrides,
  }
}

describe('monitor summary', () => {
  it('builds the bubble network contract from requests', () => {
    const summary = createMonitorSummary({
      logs: [
        request({ id: '1', status: 200, duration: 100, size: 10 }),
        request({ id: '2', status: 200, duration: 250, size: 20 }),
        request({ id: '3', status: 201, duration: 450, responseBodySize: 30 }),
      ],
      totalCount: 3,
      healthReport: {
        slowFrameRate: 0.02,
        frozenFrameCount: 0,
        tags: {
          'battery.levelPercent': '81.2',
          'battery.status': '2',
          'cpu.processPercent': '18.4',
          'frame.durationP95Ms': '24.4',
          'frame.durationP99Ms': '35.2',
          'frame.fps': '59.8',
          'frame.jankRate': '0.025',
          'memory.nativeHeapBytes': '7340032',
          'memory.ramBytes': '385194394',
          'monitor.droppedRecords': '2',
          'thermal.state': 'nominal',
        },
      },
      jsRuntimeMetrics: {
        currentLagMs: 12,
        p95LagMs: 24,
        maxLagMs: 41,
        sampleCount: 3,
        overlayRenderCostMs: 7,
        jsFps: 60,
        hermesHeapBytes: 20709376,
        layoutCostMs: 2,
        nativeHealthPollCostMs: 9,
      },
    })

    expect(summary.totalRequests).toBe(3)
    expect(summary.completedRequests).toBe(3)
    expect(summary.p95LatencyMs).toBe(450)
    expect(summary.networkLabel).toBe('P95')
    expect(summary.networkValue).toBe('450ms')
    expect(summary.networkSeverity).toBe('warning')
    expect(summary.uxLabel).toBe('UX')
    expect(summary.uxValue).toBe('OK')
    expect(summary.healthScore).toBe(85)
    expect(summary.totalDataTransferred).toBe(60)
    expect(summary.jsLagMs).toBe(12)
    expect(summary.jsLagP95Ms).toBe(24)
    expect(summary.jsLagMaxMs).toBe(41)
    expect(summary.jsLagSampleCount).toBe(3)
    expect(summary.overlayRenderCostMs).toBe(7)
    expect(summary.uiFps).toBe(60)
    expect(summary.jsFps).toBe(60)
    expect(summary.ramBytes).toBe(385194394)
    expect(summary.hermesHeapBytes).toBe(20709376)
    expect(summary.nativeHeapBytes).toBe(7340032)
    expect(summary.layoutCostMs).toBe(2)
    expect(summary.cpuPercent).toBe(18)
    expect(summary.frameDurationP95Ms).toBe(24)
    expect(summary.frameDurationP99Ms).toBe(35)
    expect(summary.jankRate).toBe(0.025)
    expect(summary.nativeHealthPollCostMs).toBe(9)
    expect(summary.monitorOverheadMs).toBe(9)
    expect(summary.droppedRecords).toBe(2)
    expect(summary.thermalState).toBe('nominal')
    expect(summary.batteryLevelPercent).toBe(81)
    expect(summary.batteryStatus).toBe('Charging')
  })

  it('prioritizes errors over p95 in the network slot', () => {
    const summary = createMonitorSummary({
      logs: [request({ id: '1', status: 200, duration: 100 }), request({ id: '2', status: 500, duration: 120 })],
      totalCount: 2,
    })

    expect(summary.errorCount).toBe(1)
    expect(summary.networkLabel).toBe('ERR')
    expect(summary.networkValue).toBe('1')
    expect(summary.networkSeverity).toBe('warning')
  })

  it('prioritizes frozen frames, jank, then JS lag in the UX slot', () => {
    expect(
      createMonitorSummary({
        logs: [],
        healthReport: { slowFrameRate: 0.2, frozenFrameCount: 2 },
        jsLagMs: 300,
      }).uxLabel,
    ).toBe('FRZ')

    const jank = createMonitorSummary({
      logs: [],
      healthReport: { slowFrameRate: 0.12, frozenFrameCount: 0 },
      jsLagMs: 300,
    })
    expect(jank.uxLabel).toBe('JNK')
    expect(jank.uxValue).toBe('12%')

    const js = createMonitorSummary({ logs: [], jsRuntimeMetrics: { currentLagMs: 20, p95LagMs: 120, maxLagMs: 240 } })
    expect(js.uxLabel).toBe('JS')
    expect(js.uxValue).toBe('120ms')

    expect(
      createMonitorSummary({
        logs: [],
        jsLagMs: 80,
      }).uxLabel,
    ).toBe('JS')
  })

  it('ignores non-finite js lag values', () => {
    const summary = createMonitorSummary({
      logs: [],
      jsLagMs: Number.NaN,
    })
    expect(summary.uxLabel).toBe('UX')
    expect(summary.uxValue).toBe('--')
  })

  it('coerces native health reports defensively', () => {
    expect(coerceHealthReport({ slowFrameRate: 0.1, frozenFrameCount: 1, summary: 'ok', tags: { fps: 60 } })).toEqual({
      slowFrameRate: 0.1,
      frozenFrameCount: 1,
      summary: 'ok',
      tags: { fps: '60' },
    })
    expect(coerceHealthReport({ slowFrameRate: '0.1' })).toBeNull()
    expect(coerceHealthReport(null)).toBeNull()
  })

  it('builds the floating monitor HUD model', () => {
    const summary = createMonitorSummary({
      logs: [request({ id: '1', status: 200, duration: 120 })],
      totalCount: 1530,
      healthReport: {
        slowFrameRate: 0,
        frozenFrameCount: 0,
        tags: {
          'frame.fps': '59.4',
        },
      },
      jsRuntimeMetrics: {
        jsFps: 42,
      },
    })

    const hud = createMonitorHudModel(summary)

    expect(hud.requestValue).toBe('1.5K')
    expect(hud.requestLabel).toBe('REQ')
    expect(hud.statusText).toBe('Capturing')
    expect(hud.healthSeverity).toBe('good')
    expect(hud.network).toEqual({ label: 'P95', value: '120ms', severity: 'good' })
    expect(hud.ui).toEqual({ label: 'UI', value: '59', severity: 'good' })
    expect(hud.js).toEqual({ label: 'JS', value: '42', severity: 'bad' })
  })
})
