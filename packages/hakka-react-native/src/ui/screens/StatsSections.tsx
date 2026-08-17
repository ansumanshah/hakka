import type { calculateDomainStats, NetworkRequest } from 'hakka-core'
import React from 'react'
import { Text, View } from 'react-native'

import type { createSharedStyles } from '../components/Details/helpers'
import type { useTheme } from '../styles'
import {
  formatCount as formatMonitorCount,
  formatBytes as formatMonitorBytes,
  formatMs as formatMonitorMs,
  formatNullablePercent as formatMonitorNullablePercent,
  formatPercent as formatMonitorPercent,
  readableMonitorLabel,
} from '../utils/format'
import type { createMonitorHudModel, MonitorSeverity, MonitorSummary } from '../utils/monitorSummary'
import { MetricCard, PerformanceDetailGrid, PerformanceFpsCard, PerformanceResourceCard, StatRow } from './StatsCards'
import { formatBytes, formatMs, formatPercent, formatUrl } from './StatsFormat'
import type { createStyles } from './StatsStyles'

type StatsStyles = ReturnType<typeof createStyles>
type SharedStyles = ReturnType<typeof createSharedStyles>
type StatsColors = ReturnType<typeof useTheme>['colors']
type DomainStats = ReturnType<typeof calculateDomainStats>

interface StatsSectionProps {
  styles: StatsStyles
  sharedStyles: SharedStyles
  colors: StatsColors
}

export const MonitorOverviewSection = React.memo(function MonitorOverviewSection({
  monitorSummary,
  hudModel,
  severityColor,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & {
  monitorSummary: MonitorSummary
  hudModel: ReturnType<typeof createMonitorHudModel>
  severityColor: (severity: MonitorSeverity) => string
}) {
  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>MONITOR OVERVIEW</Text>
      <View style={styles.monitorHero}>
        <View style={[styles.monitorHeroRail, { backgroundColor: severityColor(hudModel.healthSeverity) }]} />
        <View style={styles.monitorHeroCopy}>
          <Text style={[styles.monitorHeroLabel, { color: colors.textMuted }]}>Live</Text>
          <Text style={[styles.monitorHeroTitle, { color: colors.text }]} numberOfLines={1}>
            {hudModel.statusText}
          </Text>
          <Text style={[styles.monitorHeroMeta, { color: colors.textSubtle }]} numberOfLines={1}>
            {hudModel.requestValue} requests / {formatMonitorBytes(monitorSummary.totalDataTransferred)} moved
          </Text>
        </View>
        <View style={styles.monitorHeroScore}>
          <Text style={[styles.monitorHeroScoreValue, { color: severityColor(hudModel.healthSeverity) }]}>
            {monitorSummary.healthScore}
          </Text>
          <Text style={[styles.monitorHeroScoreLabel, { color: colors.textSubtle }]}>score</Text>
        </View>
      </View>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Health"
          value={`${monitorSummary.healthScore}`}
          caption="score"
          color={
            monitorSummary.healthScore >= 90
              ? colors.success
              : monitorSummary.healthScore >= 70
                ? colors.warning
                : colors.error
          }
          styles={styles}
        />
        <MetricCard
          label={readableMonitorLabel(monitorSummary.networkLabel)}
          value={monitorSummary.networkValue}
          caption={monitorSummary.networkLabel === 'ERR' ? 'network' : 'latency'}
          color={severityColor(monitorSummary.networkSeverity)}
          styles={styles}
        />
        <MetricCard
          label={readableMonitorLabel(monitorSummary.uxLabel)}
          value={monitorSummary.uxValue}
          caption="experience"
          color={severityColor(monitorSummary.uxSeverity)}
          styles={styles}
        />
      </View>
    </View>
  )
})

export const PerformanceSection = React.memo(function PerformanceSection({
  monitorSummary,
  nativeHealthSummary,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & {
  monitorSummary: MonitorSummary
  nativeHealthSummary: string | null
}) {
  const detailRows = [
    { label: 'CPU', value: formatMonitorNullablePercent(monitorSummary.cpuPercent) },
    { label: 'Jank', value: monitorSummary.jankRate === null ? '--' : formatMonitorPercent(monitorSummary.jankRate) },
    { label: 'Frame P95', value: formatMonitorMs(monitorSummary.frameDurationP95Ms) },
    { label: 'Frame P99', value: formatMonitorMs(monitorSummary.frameDurationP99Ms) },
    { label: 'Native Heap', value: formatMonitorBytes(monitorSummary.nativeHeapBytes) },
    { label: 'Thermal', value: monitorSummary.thermalState ?? '--' },
    {
      label: 'Battery',
      value:
        monitorSummary.batteryLevelPercent === null
          ? (monitorSummary.batteryStatus ?? '--')
          : `${formatMonitorNullablePercent(monitorSummary.batteryLevelPercent)} ${monitorSummary.batteryStatus ?? ''}`.trim(),
    },
    { label: 'Monitor Cost', value: formatMonitorMs(monitorSummary.monitorOverheadMs) },
    { label: 'Dropped', value: formatMonitorCount(monitorSummary.droppedRecords) },
  ]

  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>PERFORMANCE</Text>
      <View style={styles.performanceGrid}>
        <PerformanceFpsCard
          label="UI"
          value={monitorSummary.uiFps}
          color={monitorSummary.uiFps !== null && monitorSummary.uiFps < 50 ? colors.warning : colors.text}
          styles={styles}
        />
        <PerformanceFpsCard
          label="JS"
          value={monitorSummary.jsFps}
          color={monitorSummary.jsFps !== null && monitorSummary.jsFps < 50 ? colors.warning : colors.text}
          styles={styles}
        />
      </View>
      <View style={styles.performanceResourceGrid}>
        <PerformanceResourceCard
          label="RAM"
          value={formatMonitorBytes(monitorSummary.ramBytes)}
          color={colors.text}
          styles={styles}
        />
        <PerformanceResourceCard
          label="Hermes"
          value={formatMonitorBytes(monitorSummary.hermesHeapBytes)}
          color={colors.text}
          styles={styles}
        />
        <PerformanceResourceCard
          label="Layout"
          value={formatMonitorMs(monitorSummary.layoutCostMs)}
          color={colors.text}
          styles={styles}
        />
      </View>
      <PerformanceDetailGrid rows={detailRows} styles={styles} />
      <StatRow label="P95 Latency" value={formatMonitorMs(monitorSummary.p95LatencyMs)} sharedStyles={sharedStyles} />
      <StatRow label="JS Event Loop Lag" value={formatMonitorMs(monitorSummary.jsLagMs)} sharedStyles={sharedStyles} />
      <StatRow label="JS Lag P95" value={formatMonitorMs(monitorSummary.jsLagP95Ms)} sharedStyles={sharedStyles} />
      <StatRow label="JS Lag Max" value={formatMonitorMs(monitorSummary.jsLagMaxMs)} sharedStyles={sharedStyles} />
      <StatRow
        label="Overlay Render Cost"
        value={formatMonitorMs(monitorSummary.overlayRenderCostMs)}
        sharedStyles={sharedStyles}
      />
      <StatRow
        label="Slow Frame Rate"
        value={monitorSummary.slowFrameRate === null ? '--' : formatMonitorPercent(monitorSummary.slowFrameRate)}
        sharedStyles={sharedStyles}
      />
      <StatRow
        label="Frozen Frames"
        value={monitorSummary.frozenFrameCount === null ? '--' : formatMonitorCount(monitorSummary.frozenFrameCount)}
        sharedStyles={sharedStyles}
      />
      {nativeHealthSummary ? (
        <StatRow label="Native Health" value={nativeHealthSummary} sharedStyles={sharedStyles} />
      ) : null}
    </View>
  )
})

export const RequestRateSection = React.memo(function RequestRateSection({
  requestsPerSecond,
  maxRequestsPerSec,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & {
  requestsPerSecond: Array<{ id: string; count: number }>
  maxRequestsPerSec: number
}) {
  if (requestsPerSecond.length === 0) return null

  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>REQUESTS PER SECOND</Text>
      <View style={styles.chartContainer}>
        {requestsPerSecond.map(({ id, count }) => (
          <View key={id} style={styles.chartBarWrapper}>
            <View
              style={[
                styles.chartBar,
                {
                  height: Math.max(4, (count / maxRequestsPerSec) * 120),
                  backgroundColor: count > 0 ? colors.textMuted : colors.border,
                },
              ]}
            />
            <Text style={[styles.chartBarLabel, { color: colors.textSubtle }]}>{count}</Text>
          </View>
        ))}
      </View>
    </View>
  )
})

export const ErrorRateSection = React.memo(function ErrorRateSection({
  errorRateByDomain,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & {
  errorRateByDomain: Array<{ domain: string; total: number; errors: number; errorRate: number }>
}) {
  if (errorRateByDomain.length === 0) return null

  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>ERROR RATE BY DOMAIN</Text>
      {errorRateByDomain.slice(0, 8).map(({ domain, total, errors, errorRate }) => (
        <View key={domain} style={styles.errorRateRow}>
          <Text style={[styles.errorRateDomain, { color: colors.text }]} numberOfLines={1}>
            {domain}
          </Text>
          <View style={styles.errorRateBarContainer}>
            <View
              style={[
                styles.errorRateBar,
                {
                  width: `${errorRate * 100}%`,
                  backgroundColor: errorRate > 0.5 ? colors.error : errorRate > 0.2 ? colors.warning : colors.textMuted,
                },
              ]}
            />
          </View>
          <Text style={[styles.errorRateValue, { color: colors.textMuted }]}>
            {errors}/{total} ({formatPercent(errorRate)})
          </Text>
        </View>
      ))}
    </View>
  )
})

export const TopRequestsSection = React.memo(function TopRequestsSection({
  title,
  requests,
  metric,
  styles,
  sharedStyles,
  colors,
  spacingXs,
}: StatsSectionProps & {
  title: string
  requests: NetworkRequest[]
  metric: (request: NetworkRequest) => string
  spacingXs: number
}) {
  if (requests.length === 0) return null

  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
      {requests.map((req, index) => (
        <View key={req.id} style={[sharedStyles.headerRow, { paddingVertical: spacingXs }]}>
          <Text style={[styles.topListIndex, { color: colors.textMuted }]}>{index + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.topListUrl, { color: colors.text }]} numberOfLines={1}>
              {req.method.toUpperCase()} {formatUrl(req.url)}
            </Text>
            <Text style={[styles.topListMeta, { color: colors.textSubtle }]}>
              {req.status || '-'} • {metric(req)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
})

export const GeneralStatsSection = React.memo(function GeneralStatsSection({
  stats,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & { stats: DomainStats }) {
  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>GENERAL STATS</Text>
      <StatRow label="Total Requests" value={stats.totalRequests.toString()} sharedStyles={sharedStyles} />
      <StatRow label="Success Rate" value={formatPercent(stats.successRate)} sharedStyles={sharedStyles} />
      <StatRow label="Failure Rate" value={formatPercent(stats.failureRate)} sharedStyles={sharedStyles} />
      {stats.informationalRate > 0 && (
        <StatRow
          label="Informational Responses"
          value={formatPercent(stats.informationalRate)}
          sharedStyles={sharedStyles}
        />
      )}
      <StatRow label="Average Response Time" value={formatMs(stats.averageResponseTime)} sharedStyles={sharedStyles} />
      <StatRow label="Fastest Request" value={formatMs(stats.fastestRequest)} sharedStyles={sharedStyles} />
      <StatRow label="Slowest Request" value={formatMs(stats.slowestRequest)} sharedStyles={sharedStyles} />
      <StatRow label="Data Sent" value={formatBytes(stats.dataSent)} sharedStyles={sharedStyles} />
      <StatRow label="Data Received" value={formatBytes(stats.dataReceived)} sharedStyles={sharedStyles} />
    </View>
  )
})

export const BreakdownSection = React.memo(function BreakdownSection({
  title,
  rows,
  styles,
  sharedStyles,
  colors,
}: StatsSectionProps & {
  title: string
  rows: Array<{ label: string; value: string }>
}) {
  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
      {rows.map((row) => (
        <StatRow key={row.label} label={row.label} value={row.value} sharedStyles={sharedStyles} />
      ))}
    </View>
  )
})

export const AllUrlsSection = React.memo(function AllUrlsSection({
  allUrls,
  styles,
  sharedStyles,
  colors,
  spacingSm,
  fontSizeSm,
}: StatsSectionProps & {
  allUrls: string[]
  spacingSm: number
  fontSizeSm: number
}) {
  if (allUrls.length === 0) return null

  return (
    <View style={sharedStyles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>ALL URLS ({allUrls.length})</Text>
      {allUrls.map((url) => (
        <View key={url} style={[sharedStyles.headerRow, { paddingVertical: spacingSm }]}>
          <Text style={[sharedStyles.headerValue, { fontSize: fontSizeSm, flex: 1 }]} numberOfLines={2}>
            {url}
          </Text>
        </View>
      ))}
    </View>
  )
})
