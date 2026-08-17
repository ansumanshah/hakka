import { FlashList } from '@shopify/flash-list'
import type { NetworkRequest } from 'hakka-core'
import { calculateDomainStats, extractHost, getUniqueDomains } from 'hakka-core'
import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'

import { Chip } from '../components/Chip'
import { createSharedStyles } from '../components/Details/helpers'
import { useChromeTopInset } from '../hooks/useChromeInsets'
import { ArrowLeft } from '../icons'
import { useTheme } from '../styles'
import {
  createMonitorHudModel,
  type MonitorHealthInput,
  type MonitorSeverity,
  type MonitorSummary,
} from '../utils/monitorSummary'
import { createStatsViewModel } from '../viewModels'
import { formatBytes, formatMs } from './StatsFormat'
import {
  AllUrlsSection,
  BreakdownSection,
  ErrorRateSection,
  GeneralStatsSection,
  MonitorOverviewSection,
  PerformanceSection,
  RequestRateSection,
  TopRequestsSection,
} from './StatsSections'
import { CHART_BAR_WIDTH, CHART_BAR_GAP, createStyles } from './StatsStyles'

interface StatsProps {
  logs: NetworkRequest[]
  summary?: MonitorSummary | null
  healthReport?: MonitorHealthInput | null
  onClose: () => void
  /** False when the inspector shell renders its persistent tab strip above this
   * page — the page then owns no back button and no title of its own. */
  showHeader?: boolean
}

export const Stats: React.FC<StatsProps> = ({ logs, summary, healthReport, onClose, showHeader = true }) => {
  // Domain-filter chip row + "ALL URLS" disclosure — the only mutable,
  // intent-driven UI state this screen owns. The aggregations below stay
  // component-level useMemos over `logs` + this snapshot.
  const [statsVm] = useState(() => createStatsViewModel())
  const { selectedDomain, showAllUrls } = useSyncExternalStore(statsVm.subscribe, statsVm.getSnapshot)
  const { width: screenWidth } = useWindowDimensions()
  const theme = useTheme()
  const styles = createStyles(theme)
  const sharedStyles = createSharedStyles(theme)
  const { colors } = theme
  const chromeTopInset = useChromeTopInset()
  const fallbackMonitorSummary = useMemo(
    () =>
      ({
        totalRequests: logs.length,
        completedRequests: 0,
        successCount: 0,
        errorCount: 0,
        errorRate: 0,
        successRate: 0,
        averageResponseTime: 0,
        p95LatencyMs: null,
        totalDataTransferred: 0,
        slowFrameRate: null,
        frozenFrameCount: null,
        jsLagMs: null,
        jsLagP95Ms: null,
        jsLagMaxMs: null,
        jsLagSampleCount: 0,
        overlayRenderCostMs: null,
        uiFps: null,
        jsFps: null,
        ramBytes: null,
        hermesHeapBytes: null,
        nativeHeapBytes: null,
        layoutCostMs: null,
        cpuPercent: null,
        frameDurationP95Ms: null,
        frameDurationP99Ms: null,
        jankRate: null,
        nativeHealthPollCostMs: null,
        monitorOverheadMs: null,
        droppedRecords: 0,
        thermalState: null,
        batteryLevelPercent: null,
        batteryStatus: null,
        appVisibility: null,
        healthScore: 95,
        networkLabel: 'P95',
        networkValue: '--',
        networkSeverity: 'idle',
        uxLabel: 'UX',
        uxValue: '--',
        uxSeverity: 'idle',
      }) satisfies MonitorSummary,
    [logs.length],
  )
  const monitorSummary = summary ?? fallbackMonitorSummary

  const severityColor = (severity: MonitorSeverity) => {
    switch (severity) {
      case 'bad':
        return colors.error
      case 'warning':
        return colors.warning
      case 'good':
        return colors.success
      case 'idle':
        return colors.textMuted
    }
  }
  const nativeHealthSummary = healthReport?.summary ? healthReport.summary.replace(/\s+/g, ' ').slice(0, 80) : null
  const hudModel = useMemo(() => createMonitorHudModel(monitorSummary), [monitorSummary])

  const domains = useMemo(() => getUniqueDomains(logs), [logs])
  const domainFilters = useMemo(
    () => [
      { type: 'all' as const, id: '__all__', label: 'All' },
      ...domains.map((domain) => ({ type: 'domain' as const, id: domain, label: domain })),
    ],
    [domains],
  )
  const chartBars = Math.max(1, Math.floor(screenWidth / (CHART_BAR_WIDTH + CHART_BAR_GAP)) - 2)

  const stats = useMemo(() => {
    const domain = selectedDomain || 'all'
    return calculateDomainStats(logs, domain)
  }, [logs, selectedDomain])

  const allUrls = useMemo(() => {
    if (!showAllUrls) return []
    return Array.from(new Set(logs.map((log) => log.url))).sort()
  }, [logs, showAllUrls])

  const requestsPerSecond = useMemo(() => {
    if (logs.length < 2) return []

    const timestamps = Array.from(logs, (l) => l.startTime).sort((a, b) => a - b)
    const minTime = timestamps[0]
    const maxTime = timestamps[timestamps.length - 1]
    const durationSec = Math.max(1, (maxTime - minTime) / 1000)

    const bucketCount = Math.min(chartBars, Math.ceil(durationSec))
    const bucketSize = durationSec / bucketCount
    const buckets: number[] = Array.from({ length: bucketCount }, () => 0)

    logs.forEach((log) => {
      const bucketIndex = Math.min(bucketCount - 1, Math.floor((log.startTime - minTime) / 1000 / bucketSize))
      buckets[bucketIndex]++
    })

    return buckets.map((count, index) => ({ id: `${minTime}-${index}`, count }))
  }, [logs, chartBars])

  const maxRequestsPerSec = useMemo(() => {
    return Math.max(1, ...requestsPerSecond.map(({ count }) => count))
  }, [requestsPerSecond])

  const topSlowest = useMemo(() => {
    const candidates: NetworkRequest[] = []
    for (const log of logs) {
      if (log.duration != null && log.duration > 0) candidates.push(log)
    }
    return candidates.sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 5)
  }, [logs])

  const topLargest = useMemo(() => {
    const candidates: NetworkRequest[] = []
    for (const log of logs) {
      if (log.responseBodySize != null && log.responseBodySize > 0) candidates.push(log)
    }
    return candidates.sort((a, b) => (b.responseBodySize || 0) - (a.responseBodySize || 0)).slice(0, 5)
  }, [logs])

  const errorRateByDomain = useMemo(() => {
    const domainMap: Record<string, { total: number; errors: number }> = {}

    logs.forEach((log) => {
      const domain = extractHost(log.url)
      if (!domainMap[domain]) {
        domainMap[domain] = { total: 0, errors: 0 }
      }
      domainMap[domain].total++
      if (log.status != null && log.status >= 400) {
        domainMap[domain].errors++
      }
    })

    const rates: Array<{ domain: string; total: number; errors: number; errorRate: number }> = []
    for (const [domain, { total, errors }] of Object.entries(domainMap)) {
      if (total > 0) {
        rates.push({ domain, total, errors, errorRate: errors / total })
      }
    }
    return rates.sort((a, b) => b.errorRate - a.errorRate)
  }, [logs])

  const methodBreakdownRows = useMemo(() => {
    const rows: Array<{ label: string; count: number }> = []
    for (const [method, count] of Object.entries(stats.methodBreakdown)) {
      rows.push({ label: method, count })
    }
    rows.sort((a, b) => b.count - a.count)
    return rows.map(({ label, count }) => ({
      label,
      value: `${count} (${stats.totalRequests === 0 ? '0.0' : ((count / stats.totalRequests) * 100).toFixed(1)}%)`,
    }))
  }, [stats.methodBreakdown, stats.totalRequests])

  const statusCodeRows = useMemo(() => {
    const rows: Array<{ label: string; count: number }> = []
    for (const [status, count] of Object.entries(stats.statusCodeDistribution)) {
      rows.push({ label: status, count })
    }
    rows.sort((a, b) => Number(a.label) - Number(b.label))
    return rows.map(({ label, count }) => ({ label, value: count.toString() }))
  }, [stats.statusCodeDistribution])

  const formatDurationMetric = useCallback((request: NetworkRequest) => formatMs(request.duration || 0), [])
  const formatSizeMetric = useCallback((request: NetworkRequest) => formatBytes(request.responseBodySize || 0), [])

  const renderDomainFilter = useCallback(
    ({ item }: { item: (typeof domainFilters)[number] }) =>
      item.type === 'all' ? (
        <Chip label={item.label} active={showAllUrls} onPress={statsVm.intents.toggleShowAllUrls} />
      ) : (
        <Chip
          label={item.label}
          active={selectedDomain === item.id}
          onPress={() => statsVm.intents.selectDomain(item.id)}
        />
      ),
    [selectedDomain, showAllUrls, statsVm],
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: chromeTopInset }}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close stats panel"
            onPress={onClose}
            style={styles.backButton}
          >
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Monitor</Text>
          <View style={styles.headerRight} />
        </View>
      )}

      {domains.length > 0 && (
        <View style={[styles.domainRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <FlashList
            horizontal
            data={domainFilters}
            keyExtractor={(item) => item.id}
            renderItem={renderDomainFilter}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.domainBadges}
          />
        </View>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <MonitorOverviewSection
          monitorSummary={monitorSummary}
          hudModel={hudModel}
          severityColor={severityColor}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        <PerformanceSection
          monitorSummary={monitorSummary}
          nativeHealthSummary={nativeHealthSummary}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        <RequestRateSection
          requestsPerSecond={requestsPerSecond}
          maxRequestsPerSec={maxRequestsPerSec}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        <ErrorRateSection
          errorRateByDomain={errorRateByDomain}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        <TopRequestsSection
          title="TOP 5 SLOWEST"
          requests={topSlowest}
          metric={formatDurationMetric}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
          spacingXs={theme.spacing.xs}
        />
        <TopRequestsSection
          title="TOP 5 LARGEST"
          requests={topLargest}
          metric={formatSizeMetric}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
          spacingXs={theme.spacing.xs}
        />
        <GeneralStatsSection stats={stats} styles={styles} sharedStyles={sharedStyles} colors={colors} />
        <BreakdownSection
          title="HTTP METHODS"
          rows={methodBreakdownRows}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        <BreakdownSection
          title="STATUS CODES"
          rows={statusCodeRows}
          styles={styles}
          sharedStyles={sharedStyles}
          colors={colors}
        />
        {showAllUrls ? (
          <AllUrlsSection
            allUrls={allUrls}
            styles={styles}
            sharedStyles={sharedStyles}
            colors={colors}
            spacingSm={theme.spacing.sm}
            fontSizeSm={theme.fontSize.sm}
          />
        ) : null}
      </ScrollView>
    </View>
  )
}
