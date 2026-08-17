import React from 'react'
import { Text, View } from 'react-native'

import type { createSharedStyles } from '../components/Details/helpers'
import type { createStyles } from './StatsStyles'

export const StatRow: React.FC<{
  label: string
  value: string
  sharedStyles: ReturnType<typeof createSharedStyles>
}> = ({ label, value, sharedStyles }) => (
  <View style={sharedStyles.headerRow}>
    <Text style={sharedStyles.headerKey}>{label}</Text>
    <Text style={sharedStyles.headerValue}>{value}</Text>
  </View>
)

export const MetricCard: React.FC<{
  label: string
  value: string
  caption?: string
  color: string
  styles: ReturnType<typeof createStyles>
}> = ({ label, value, caption, color, styles }) => (
  <View style={styles.metricCard}>
    <Text style={[styles.metricValue, { color }]} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.metricLabel} numberOfLines={1}>
      {label}
    </Text>
    {caption ? (
      <Text style={styles.metricCaption} numberOfLines={1}>
        {caption}
      </Text>
    ) : null}
  </View>
)

export const PerformanceFpsCard: React.FC<{
  label: string
  value: number | null
  color: string
  styles: ReturnType<typeof createStyles>
}> = ({ label, value, color, styles }) => {
  const displayValue = value === null ? '--' : `${Math.round(value)}`
  const samples = fpsSparklineSamples(value)

  return (
    <View style={styles.performanceFpsCard}>
      <View style={styles.sparkline}>
        {samples.map((sample, index) => (
          <View
            key={sample.id}
            style={[
              styles.sparklineBar,
              {
                height: sample.height,
                backgroundColor: color,
                opacity: value === null ? 0.18 : index === samples.length - 1 ? 1 : 0.42,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.performanceCardFooter}>
        <Text style={styles.performanceLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.performanceValue, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {displayValue}
          <Text style={styles.performanceUnit}> fps</Text>
        </Text>
      </View>
    </View>
  )
}

export const PerformanceResourceCard: React.FC<{
  label: string
  value: string
  color: string
  styles: ReturnType<typeof createStyles>
}> = ({ label, value, color, styles }) => {
  const { amount, unit } = splitMetricValue(value)

  return (
    <View style={styles.performanceResourceCard}>
      <Text style={styles.performanceLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.resourceValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68}>
        {amount}
        {unit ? <Text style={styles.resourceUnit}> {unit}</Text> : null}
      </Text>
    </View>
  )
}

export const PerformanceDetailGrid: React.FC<{
  rows: Array<{ label: string; value: string }>
  styles: ReturnType<typeof createStyles>
}> = ({ rows, styles }) => (
  <View style={styles.performanceDetailGrid}>
    {rows.map((row) => (
      <View key={row.label} style={styles.performanceDetailItem}>
        <Text style={styles.performanceDetailLabel} numberOfLines={1}>
          {row.label}
        </Text>
        <Text style={styles.performanceDetailValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {row.value}
        </Text>
      </View>
    ))}
  </View>
)

function fpsSparklineSamples(value: number | null): Array<{ id: string; height: number }> {
  const base = value === null ? 0 : Math.max(0, Math.min(60, value))
  const normalized = base <= 0 ? 12 : 16 + (base / 60) * 28
  return [
    ['a', 0.92],
    ['b', 0.98],
    ['c', 0.94],
    ['d', 1],
    ['e', 1],
    ['f', 1],
    ['g', 1],
    ['h', 1],
    ['i', 0.96],
    ['j', 1],
    ['k', 1],
    ['l', 1],
  ].map(([id, scale]) => ({
    id: String(id),
    height: Math.max(8, Math.round(normalized * Number(scale))),
  }))
}

function splitMetricValue(value: string): { amount: string; unit: string } {
  const [amount, ...unit] = value.split(' ')
  return { amount, unit: unit.join(' ') }
}
