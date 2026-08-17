import type { NetworkRequest } from 'hakka-core'
import { parseUrl } from 'hakka-core'
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { createStyleSheet, statusColor, useTheme } from '../styles'
import { getRowSeverity, hostColor } from '../utils/rowSeverity'
import { MethodLabel } from './Badge'

export interface NetworkRowProps {
  request: NetworkRequest
  onPress: (request: NetworkRequest) => void
  searchTerm?: string
  /** When true the row is highlighted as selected (multi-select mode). */
  selected?: boolean
}

const NETWORK_ROW_HEIGHT = 64

export const Row = React.memo(function Row({ request, onPress, searchTerm, selected = false }: NetworkRowProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const { host, path, isSecure } = parseUrl(request.url)
  const statusLabel = request.error ? 'error' : request.status ? String(request.status) : 'pending'
  const statusTextColor = request.error ? colors.chili : statusColor(request.status ?? undefined)
  const durationColor =
    (request.duration ?? 0) >= 3000
      ? colors.chili
      : (request.duration ?? 0) >= 1000
        ? colors.turmeric
        : colors.textMuted
  const size = request.responseBodySize ?? request.size ?? 0
  const source = request.source === 'websocket' ? 'WS' : request.source?.toUpperCase()
  const { pathPart, queryPart } = splitPath(path)

  const gqlOpName = request.graphql?.operationName

  // Severity stripe + row-background wash — see rowSeverity.ts for the full
  // grammar. Matches iOS's edge-stripe + ~8%-alpha background treatment
  // rather than Android's stripe-only one.
  const { stripeColor, rowBackground } = getRowSeverity(request, selected, colors)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Request ${request.method} ${host}${path} source ${source ?? 'UNKNOWN'} status ${statusLabel}`}
      testID={`hakka-request-row-${request.id}`}
      style={({ pressed }) => [
        styles.container,
        { borderBottomColor: colors.border, borderLeftColor: stripeColor },
        rowBackground !== undefined && { backgroundColor: rowBackground },
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => onPress(request)}
    >
      <View style={styles.content}>
        <View style={styles.mainColumn}>
          <View style={styles.topRow}>
            <MethodLabel method={request.method} width={46} />

            {/* Path and query are two sibling Texts, not one nested Text — nesting
                made ellipsizeMode="middle" measure the concatenated run, splicing
                path and query together unreadably. Split, the path keeps its
                middle ellipsis and the query yields width first. */}
            <View style={styles.pathWrapper}>
              <Text style={[styles.path, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
                {highlight(pathPart, searchTerm, colors.codeHighlight)}
              </Text>
              {queryPart ? (
                <Text style={[styles.queryParams, { color: colors.textSubtle }]} numberOfLines={1} ellipsizeMode="tail">
                  {highlight(queryPart, searchTerm, colors.codeHighlight)}
                </Text>
              ) : null}
            </View>

            {request.mocked ? <Text style={[styles.pin, { color: colors.turmeric }]}>PIN</Text> : null}
          </View>

          {gqlOpName ? (
            <View style={styles.gqlRow}>
              <Text style={[styles.gqlPill, { color: colors.accent, borderColor: colors.accent }]}>
                {`GQL: ${gqlOpName}`}
              </Text>
            </View>
          ) : null}

          {/* No absolute HH:MM:SS timestamp here — during a live debugging
              session everything on screen is "now", so the row spends its
              scarce width on host instead. Still available at
              Detail → Overview → Started, matching iOS. */}
          <View style={styles.bottomRow}>
            <Text style={[styles.statusText, { color: statusTextColor }]}>
              {request.status != null ? request.status : request.error ? 'ERR' : 'PENDING'}
            </Text>

            <Text style={[styles.host, { color: hostColor(host, isSecure, colors) }]} numberOfLines={1}>
              {host}
            </Text>

            {source ? (
              <View style={[styles.sourcePill, { borderColor: colors.border }]}>
                <Text style={[styles.sourcePillText, { color: colors.textSubtle }]}>{source}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Duration over size in one right-aligned column — mirrors the
            path-over-host stack and mirrors web's .hakka-row-timing. */}
        <View style={styles.timingColumn}>
          <Text style={[styles.duration, { color: durationColor }]}>
            {formatDuration(request.duration ?? undefined) ?? '...'}
          </Text>
          {size > 0 ? (
            <Text style={[styles.metricText, { color: colors.textSubtle + 'BF' }]}>{formatSize(size)}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
})

function splitPath(path: string) {
  const queryIndex = path.indexOf('?')
  if (queryIndex === -1) return { pathPart: path, queryPart: '' }
  return {
    pathPart: path.substring(0, queryIndex),
    queryPart: path.substring(queryIndex),
  }
}

function formatDuration(duration?: number) {
  if (!duration) return null
  return duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(1)}s`
}

function formatSize(size?: number) {
  if (!size) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function highlight(text: string, term: string | undefined, backgroundColor: string) {
  if (!term) return text
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  let offset = 0
  return parts.map((part) => {
    const key = `${offset}-${part}`
    offset += part.length
    return part.toLowerCase() === term.toLowerCase() ? (
      <Text key={key} style={{ backgroundColor, fontWeight: '600' }}>
        {part}
      </Text>
    ) : (
      part
    )
  })
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    minHeight: NETWORK_ROW_HEIGHT,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderLeftWidth: 2,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: theme.spacing.ll,
    paddingRight: theme.spacing.ll,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  gqlRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gqlPill: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 1,
    alignSelf: 'flex-start' as const,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  pathWrapper: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  path: {
    flexShrink: 1,
    fontSize: theme.fontSize.md,
    fontFamily: 'monospace',
    fontWeight: theme.fontWeight.medium,
  },
  // Shrinks ~20x faster than the path, so a long query string gives up its
  // width before the path starts losing characters.
  queryParams: {
    flexShrink: 20,
    fontSize: theme.fontSize.md,
    fontFamily: 'monospace',
    fontWeight: theme.fontWeight.medium,
  },
  pin: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
  },
  // Right-aligned column: duration on line 1, size on line 2 (dimmer) — one
  // fixed-width stack instead of two side-by-side columns.
  timingColumn: {
    alignItems: 'flex-end',
    minWidth: 52,
    gap: 1,
  },
  duration: {
    fontSize: theme.fontSize.md,
    fontFamily: 'monospace',
    fontWeight: theme.fontWeight.medium,
    fontVariant: ['tabular-nums'] as const,
    textAlign: 'right' as const,
  },
  // Deliberately identical geometry to MethodLabel above it — same 46pt fixed
  // width, left edge, and mono/xs/bold face, so both lines' leading edges align.
  statusText: {
    width: 46,
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
  },
  metricText: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'] as const,
    textAlign: 'right' as const,
  },
  sourcePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 1,
  },
  sourcePillText: {
    fontSize: theme.fontSize.xxs,
    fontWeight: theme.fontWeight.semibold,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  host: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
  },
}))
