import type { NetworkRequest } from 'hakka-core'
import { parseUrl } from 'hakka-core'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { MethodLabel } from '../components/Badge'
import { HakkaMark } from '../components/HakkaMark'
import { BarChart2, SlidersHorizontal } from '../icons'
import { radius, statusColor } from '../styles'
import type { useTheme } from '../styles'
import type { createMonitorHudModel } from '../utils/monitorSummary'
import type { createStyles } from './HakkaInspectorStyles'

// Collapsed: severity rail + request/UI/JS metrics. Expanded: adds the recent-
// requests list. Neither opens the inspector sheet — only long-press does.
export type BubbleHudMode = 'collapsed' | 'expanded'

interface FloatingHudProps {
  bubbleHeight: number
  bubbleWidth: number
  colors: ReturnType<typeof useTheme>['colors']
  healthColor: string
  model: ReturnType<typeof createMonitorHudModel>
  styles: ReturnType<typeof createStyles>
  mode: BubbleHudMode
  /** Most recent requests, newest first — rendered only when `mode === 'expanded'`. */
  recentRequests: NetworkRequest[]
  onToggleExpand: () => void
  onOpenStats: () => void
  onOpenSettings: () => void
  accessibilityLabel: string
  accessibilityHint: string
  /** Pulse the brand mark's broadcast arcs while capturing (not paused). */
  isCapturing: boolean
}

function metricColor(colors: ReturnType<typeof useTheme>['colors'], severity: 'idle' | 'good' | 'warning' | 'bad') {
  switch (severity) {
    case 'good':
      return colors.success
    case 'warning':
      return colors.warning
    case 'bad':
      return colors.error
    case 'idle':
      return colors.textMuted
  }
}

export function FloatingMonitorHud({
  bubbleHeight,
  bubbleWidth,
  colors,
  healthColor,
  model,
  styles,
  mode,
  recentRequests,
  onToggleExpand,
  onOpenStats,
  onOpenSettings,
  accessibilityLabel,
  accessibilityHint,
  isCapturing,
}: FloatingHudProps) {
  const metrics = [model.network, model.ui, model.js]

  return (
    <View
      style={[
        styles.hud,
        {
          width: bubbleWidth,
          minHeight: bubbleHeight,
          borderRadius: radius.lg,
          backgroundColor: colors.backgroundAlt,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.hudTopRow, { height: bubbleHeight }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ expanded: mode === 'expanded' }}
          testID="hakka-inspector-bubble"
          style={({ pressed }) => [styles.hudMain, pressed && { opacity: 0.78 }]}
          onPress={onToggleExpand}
        >
          <View style={[styles.hudHealthRail, { backgroundColor: healthColor }]} />
          <View style={styles.hudMark}>
            <HakkaMark size={18} live={isCapturing} />
          </View>
          <View style={styles.hudRequestBlock}>
            <Text style={[styles.hudRequestValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              {model.requestValue}
            </Text>
            <Text style={[styles.hudRequestLabel, { color: colors.textMuted }]} numberOfLines={1}>
              {model.requestLabel}
            </Text>
          </View>
          <View style={styles.hudMetrics}>
            {metrics.map((metric) => (
              <View key={metric.label} style={styles.hudMetric}>
                <Text
                  style={[styles.hudMetricValue, { color: metricColor(colors, metric.severity) }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                >
                  {metric.value}
                </Text>
                <Text style={[styles.hudMetricLabel, { color: colors.textSubtle }]} numberOfLines={1}>
                  {metric.label}
                </Text>
              </View>
            ))}
          </View>
        </Pressable>
        <View style={[styles.hudActions, { borderLeftColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open performance dashboard"
            style={({ pressed }) => [styles.hudIconButton, pressed && { opacity: 0.7 }]}
            onPress={onOpenStats}
          >
            <BarChart2 size={15} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open monitor settings"
            style={({ pressed }) => [styles.hudIconButton, pressed && { opacity: 0.7 }]}
            onPress={onOpenSettings}
          >
            <SlidersHorizontal size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {mode === 'expanded' && (
        <View style={[styles.hudRecentList, { borderTopColor: colors.border }]} testID="hakka-inspector-bubble-recent">
          {recentRequests.length === 0 ? (
            <Text style={[styles.hudRecentEmpty, { color: colors.textMuted }]}>No requests yet</Text>
          ) : (
            recentRequests.map((request) => (
              <HudRecentRow key={request.id} colors={colors} request={request} styles={styles} />
            ))
          )}
        </View>
      )}
    </View>
  )
}

interface HudRecentRowProps {
  request: NetworkRequest
  colors: ReturnType<typeof useTheme>['colors']
  styles: ReturnType<typeof createStyles>
}

/** Method + path + status, same plain-text treatment as Row.tsx (DESIGN.md:
 * chips are for controls, rows get plain text). No stripe/duration/size —
 * a glance-sized summary, not a shrunken request list. */
function HudRecentRow({ request, colors, styles }: HudRecentRowProps) {
  const { path } = parseUrl(request.url)
  const statusLabel = request.error ? 'ERR' : request.status != null ? String(request.status) : 'PENDING'
  const statusTextColor = request.error ? colors.chili : statusColor(request.status ?? undefined)

  return (
    <View style={styles.hudRecentRow}>
      <MethodLabel method={request.method} width={38} />
      <Text style={[styles.hudRecentPath, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
        {path}
      </Text>
      <Text style={[styles.hudRecentStatus, { color: statusTextColor }]} numberOfLines={1}>
        {statusLabel}
      </Text>
    </View>
  )
}
