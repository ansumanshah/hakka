/**
 * WsFramesTab — WebSocket frame list for a captured WebSocket request.
 * Decodes protocol annotations via wsFrameDecoders (MQTT / Socket.IO / STOMP /
 * graphql-ws). Only mounted for requests where source === 'websocket' and
 * messages exist.
 */
import { FlashList } from '@shopify/flash-list'
import type { NetworkRequest, WsMessage } from 'hakka-core'
import { decodeWsFrame } from 'hakka-core'
import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

import { useSheetScrollable } from '../../hooks/useSheetScrollable'
import { createStyleSheet, useTheme } from '../../styles'

interface WsFramesTabProps {
  request: NetworkRequest
}

interface AnnotatedFrame {
  id: string
  message: WsMessage
  index: number
  decodedKind: string | null
  decodedSummary: string | null
  displayPayload: string
  isBinary: boolean
  isBinaryCapped: boolean
}

function formatFrameTime(baseTime: number, frameTime: number): string {
  const delta = frameTime - baseTime
  if (delta < 1000) return `+${Math.round(delta)}ms`
  return `+${(delta / 1000).toFixed(2)}s`
}

function formatFrameSize(size: number): string {
  if (size < 1024) return `${size}B`
  return `${(size / 1024).toFixed(1)}kB`
}

function buildAnnotatedFrames(request: NetworkRequest): AnnotatedFrame[] {
  const messages = request.messages
  if (!messages || messages.length === 0) return []
  const baseTime = request.startTime
  const protocol = request.wsProtocol ?? ''

  return messages.map((msg, index) => {
    const isBinary = msg.binary === true
    // data is a number when the binary frame exceeded the capture cap (byte count only)
    const isBinaryCapped = isBinary && typeof msg.data === 'number'

    let displayPayload: string
    if (isBinaryCapped) {
      displayPayload = `<binary: ${msg.data as number} bytes>`
    } else if (isBinary) {
      // data is base64
      const b64 = typeof msg.data === 'string' ? msg.data : ''
      displayPayload = b64.length > 80 ? `${b64.slice(0, 80)}…` : b64
    } else {
      const text = typeof msg.data === 'string' ? msg.data : String(msg.data)
      displayPayload = text.length > 200 ? `${text.slice(0, 200)}…` : text
    }

    // Run decoder pipeline — skip if binary-capped (no data to decode)
    let decodedKind: string | null = null
    let decodedSummary: string | null = null
    if (!isBinaryCapped) {
      const frameArg = { data: msg.data, binary: isBinary }
      const info = decodeWsFrame(frameArg, protocol)
      if (info) {
        decodedKind = info.kind
        decodedSummary = info.payloadPreview ? `${info.summary}  ${info.payloadPreview}` : info.summary
      }
    }

    return {
      id: `${index}-${msg.timestamp}`,
      message: msg,
      index,
      decodedKind,
      decodedSummary,
      displayPayload,
      isBinary,
      isBinaryCapped,
    }
  })
}

interface FrameRowProps {
  frame: AnnotatedFrame
  baseTime: number
  colors: ReturnType<typeof useTheme>['colors']
  styles: ReturnType<typeof createStyles>
}

const FrameRow: React.FC<FrameRowProps> = ({ frame, baseTime, colors, styles }) => {
  const isSent = frame.message.direction === 'sent'
  const directionColor = isSent ? colors.methodPost : colors.success
  const directionLabel = isSent ? '↑' : '↓'

  return (
    <View style={[styles.frameRow, { borderBottomColor: colors.border }]}>
      <View style={styles.frameMeta}>
        <Text style={[styles.direction, { color: directionColor }]}>{directionLabel}</Text>
        <Text style={[styles.frameTime, { color: colors.textSubtle }]}>
          {formatFrameTime(baseTime, frame.message.timestamp)}
        </Text>
        <Text style={[styles.frameSize, { color: colors.textMuted }]}>{formatFrameSize(frame.message.size)}</Text>
        {frame.isBinary && (
          <Text style={[styles.badge, { backgroundColor: colors.backgroundAlt, color: colors.textSubtle }]}>
            binary
          </Text>
        )}
        {frame.decodedKind && (
          <Text
            style={[
              styles.badge,
              styles.protocolBadge,
              { backgroundColor: colors.accent + '1A', color: colors.accent },
            ]}
          >
            {frame.decodedKind}
          </Text>
        )}
      </View>

      {frame.decodedSummary ? (
        <Text style={[styles.decodedSummary, { color: colors.text }]} selectable numberOfLines={2}>
          {frame.decodedSummary}
        </Text>
      ) : (
        <Text style={[styles.rawPayload, { color: colors.textMuted }]} selectable numberOfLines={3}>
          {frame.displayPayload}
        </Text>
      )}
    </View>
  )
}

export const WsFramesTab: React.FC<WsFramesTabProps> = ({ request }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const renderScrollComponent = useSheetScrollable()

  const frames = useMemo(() => buildAnnotatedFrames(request), [request])
  const baseTime = request.startTime

  if (frames.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.textSubtle }]}>No frames captured</Text>
      </View>
    )
  }

  const protocol = request.wsProtocol
  const sentCount = frames.filter((f) => f.message.direction === 'sent').length
  const receivedCount = frames.length - sentCount

  return (
    <View style={styles.container}>
      <View style={[styles.summary, { backgroundColor: colors.backgroundAlt, borderBottomColor: colors.border }]}>
        {protocol ? <Text style={[styles.summaryText, { color: colors.textMuted }]}>Protocol: {protocol}</Text> : null}
        <Text style={[styles.summaryText, { color: colors.textSubtle }]}>
          ↑ {sentCount} sent ↓ {receivedCount} received
        </Text>
      </View>

      <FlashList
        data={frames}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FrameRow frame={item} baseTime={baseTime} colors={colors} styles={styles} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderScrollComponent={renderScrollComponent}
      />
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xxl,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    gap: theme.spacing.md,
  },
  summaryText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  list: {
    paddingBottom: theme.spacing.xl,
  },
  frameRow: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    gap: theme.spacing.xs,
  },
  frameMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  direction: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
    fontFamily: 'monospace',
    width: 14,
  },
  frameTime: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'] as const,
    minWidth: 60,
  },
  frameSize: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
  },
  badge: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
  },
  protocolBadge: {
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  decodedSummary: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  rawPayload: {
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
  },
}))
