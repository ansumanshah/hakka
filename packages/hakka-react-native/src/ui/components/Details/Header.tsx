import type { NetworkRequest } from 'hakka-core'
import {
  buildAxios,
  buildCurl,
  buildFetch,
  buildHttpie,
  buildMswHandlers,
  buildPython,
  exportPostmanString,
  generateMockRules,
  mockEngine,
  networkRequestToRecord,
  parseUrl,
  recordsToOtelJson,
  splitPathAndQuery,
} from 'hakka-core'
import React, { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native'

import { saveMockRules } from '../../../storage/mockStorage'
import { ArrowLeft, Check, Download, RotateCcw, X } from '../../icons'
import { controlHeight, createStyleSheet, statusColor as getStatusColor, useTheme } from '../../styles'
import { lightImpact } from '../../utils/haptics'
import { hostColor } from '../../utils/rowSeverity'
import { MethodChip } from '../Badge'
import { formatDuration } from './helpers'
import { ReplayEditor } from './ReplayEditor'
import type { EditableRequest } from './ReplayEditor'

interface HeaderProps {
  url: string
  onClose: () => void
  request?: NetworkRequest
}

export const Header: React.FC<HeaderProps> = ({ url, onClose, request }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const [replaying, setReplaying] = useState(false)
  const [replayStatus, setReplayStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [mockStatus, setMockStatus] = useState<'idle' | 'success'>('idle')

  // Edit-before-replay state
  const [editorVisible, setEditorVisible] = useState(false)
  const [editorSendStatus, setEditorSendStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')

  const copyToClipboard = (text: string) => {
    Share.share({ message: text }).catch(() => {})
  }

  const shareSnippet = (build: (r: NetworkRequest) => string, title: string) => {
    if (!request) return
    try {
      Share.share({ message: build(request), title }).catch(() => {})
    } catch {
      Alert.alert('Copy failed', `Could not build ${title}.`)
    }
  }

  const handleCopyAs = () => {
    if (!request) return
    Alert.alert('Copy as', 'Choose a snippet format', [
      { text: 'cURL', onPress: () => shareSnippet(buildCurl, 'cURL command') },
      { text: 'fetch()', onPress: () => shareSnippet(buildFetch, 'fetch snippet') },
      { text: 'axios', onPress: () => shareSnippet(buildAxios, 'axios snippet') },
      { text: 'HTTPie', onPress: () => shareSnippet(buildHttpie, 'HTTPie command') },
      { text: 'Python (requests)', onPress: () => shareSnippet(buildPython, 'Python snippet') },
      { text: 'MSW handler', onPress: () => shareSnippet((r) => buildMswHandlers([r]), 'MSW handler') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const handleShareRequest = () => {
    if (!request) return
    Alert.alert('Export request', 'Choose format', [
      { text: 'Copy as…', onPress: handleCopyAs },
      {
        text: 'OTel JSON',
        onPress: () => {
          try {
            const record = networkRequestToRecord(request)
            const json = recordsToOtelJson([record])
            Share.share({ message: JSON.stringify(json, null, 2), title: 'OTel export' }).catch(() => {})
          } catch {
            Alert.alert('Export failed', 'Could not build OTel export.')
          }
        },
      },
      {
        text: 'Postman',
        onPress: () => {
          try {
            Share.share({ message: exportPostmanString([request]), title: 'Postman collection' }).catch(() => {})
          } catch {
            Alert.alert('Export failed', 'Could not build Postman collection.')
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const replayRequest = async () => {
    if (!request || replaying) return
    lightImpact()
    setReplaying(true)
    setReplayStatus('idle')
    try {
      const opts: RequestInit = {
        method: request.method,
        headers: request.requestHeaders as Record<string, string> | undefined,
      }
      if (request.requestBody && !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
        opts.body = request.requestBody
      }
      const res = await fetch(request.url, opts)
      setReplayStatus(res.ok ? 'success' : 'error')
    } catch {
      setReplayStatus('error')
    } finally {
      setReplaying(false)
      setTimeout(() => setReplayStatus('idle'), 2500)
    }
  }

  // One-click "record then mock": turn this captured request into an enabled
  // mock rule (same engine as hakka mcp's generate_mocks and the web Detail
  // tab's mockThis()). Only offered when the response was actually captured.
  const canMock = () => request != null && (request.status != null || request.responseBody != null)
  const mockThis = () => {
    if (!request) return
    const rules = generateMockRules([request], { idPrefix: 'ui-mock' })
    if (rules.length === 0) return
    lightImpact()
    for (const r of rules) mockEngine.addRule(r)
    void saveMockRules(mockEngine.serialize())
    setMockStatus('success')
    setTimeout(() => setMockStatus('idle'), 1800)
  }

  const openEditor = () => {
    if (!request) return
    setEditorSendStatus('idle')
    setEditorVisible(true)
  }

  const handleEditorSend = async (edited: EditableRequest) => {
    lightImpact()
    setEditorSendStatus('pending')
    try {
      let parsedHeaders: Record<string, string> = {}
      try {
        parsedHeaders = JSON.parse(edited.headers)
      } catch {
        // ignore parse error, send without headers
      }
      const opts: RequestInit = {
        method: edited.method,
        headers: parsedHeaders,
      }
      if (edited.body && !['GET', 'HEAD'].includes(edited.method)) {
        opts.body = edited.body
      }
      const res = await fetch(edited.url, opts)
      setEditorSendStatus(res.ok ? 'success' : 'error')
    } catch {
      setEditorSendStatus('error')
    } finally {
      // Auto-close on success after brief delay
      setTimeout(() => {
        setEditorSendStatus('idle')
        setEditorVisible(false)
      }, 1500)
    }
  }

  // Mock this / Export / Replay are all co-equal, low-frequency detail
  // actions — one shared outlined-pill treatment for all three. Export gets
  // the same icon+label pill as Replay rather than a bespoke unlabeled
  // icon-only treatment nobody else on the row uses.
  const replayIdle = replayStatus === 'idle'
  const replayBg =
    replayStatus === 'success' ? colors.success : replayStatus === 'error' ? colors.chili : colors.backgroundAlt
  const replayBorder =
    replayStatus === 'success' ? colors.success : replayStatus === 'error' ? colors.chili : colors.border
  const replayFg = replayIdle ? colors.textMuted : colors.background

  const { host, path, isSecure } = parseUrl(url)
  const { pathPart, queryPart } = splitPathAndQuery(path)
  const statusColor = request?.error
    ? colors.chili
    : request?.status == null
      ? colors.pending
      : request.status < 300
        ? colors.success
        : request.status < 400
          ? getStatusColor(request.status)
          : colors.chili

  return (
    <>
      <View style={[styles.header, { backgroundColor: colors.backgroundAlt, borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close request details"
          testID="hakka-details-back"
          style={[styles.backBtn, { backgroundColor: colors.background }]}
          onPress={onClose}
        >
          <ArrowLeft size={16} color={colors.textMuted} />
        </Pressable>
        {request && <MethodChip method={request.method} width={46} />}
        <Pressable accessibilityRole="button" onLongPress={() => copyToClipboard(url)} style={styles.urlContainer}>
          <Text style={[styles.pathWrapper, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
            <Text style={[styles.pathText, { color: colors.text }]}>{pathPart}</Text>
            {queryPart && <Text style={[styles.queryParams, { color: colors.textMuted }]}>{queryPart}</Text>}
          </Text>
          <Text style={[styles.hostText, { color: hostColor(host, isSecure, colors) }]} numberOfLines={1}>
            {host}
          </Text>
        </Pressable>
        {request && (
          <View style={styles.metaGroup}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {request.status != null ? request.status : request.error ? 'ERR' : ''}
            </Text>
            {request.duration ? (
              <Text style={[styles.durationText, { color: colors.textMuted }]}>{formatDuration(request.duration)}</Text>
            ) : null}
          </View>
        )}
        {/* A stream still receiving — same jade "live" tag as the request list and web Detail. */}
        {request?.streaming && (
          <View
            style={[styles.liveBadge, { borderColor: `${colors.success}66`, backgroundColor: `${colors.success}1A` }]}
          >
            <Text style={[styles.liveBadgeText, { color: colors.success }]}>LIVE</Text>
          </View>
        )}
        {request && canMock() && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mock this request"
            testID="hakka-mock-this"
            onPress={mockThis}
            style={[
              styles.actionPill,
              {
                backgroundColor: mockStatus === 'success' ? colors.success : colors.backgroundAlt,
                borderColor: mockStatus === 'success' ? colors.success : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.actionPillText,
                { color: mockStatus === 'success' ? colors.background : colors.textMuted },
              ]}
            >
              {mockStatus === 'success' ? 'Mocked' : 'Mock this'}
            </Text>
          </Pressable>
        )}
        {request && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Export request"
            testID="hakka-export-request"
            onPress={handleShareRequest}
            style={[styles.actionPill, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}
          >
            <Download size={13} color={colors.textMuted} />
            <Text style={[styles.actionPillText, { color: colors.textMuted }]}>Export</Text>
          </Pressable>
        )}
        {request && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Replay request"
            testID="hakka-replay-request"
            onPress={replayRequest}
            onLongPress={openEditor}
            disabled={replaying}
            style={[
              styles.actionPill,
              {
                backgroundColor: replayBg,
                borderColor: replayBorder,
                opacity: replaying ? 0.6 : 1,
              },
            ]}
          >
            {replaying ? (
              <ActivityIndicator size="small" color={replayFg} />
            ) : replayStatus === 'success' ? (
              <Check size={13} color={replayFg} />
            ) : replayStatus === 'error' ? (
              <X size={13} color={replayFg} />
            ) : (
              <RotateCcw size={13} color={replayFg} />
            )}
            <Text style={[styles.actionPillText, { color: replayFg }]}>
              {replaying
                ? 'Replaying'
                : replayStatus === 'success'
                  ? 'Sent'
                  : replayStatus === 'error'
                    ? 'Failed'
                    : 'Replay'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Edit-before-replay modal */}
      {request && editorVisible && (
        <ReplayEditor
          request={request}
          visible={editorVisible}
          onClose={() => setEditorVisible(false)}
          onSend={handleEditorSend}
          sendStatus={editorSendStatus}
        />
      )}
    </>
  )
}

const createStyles = createStyleSheet(({ spacing, radius, fontSize, fontWeight }) => ({
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.ml,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backBtn: {
    width: controlHeight.icon,
    height: controlHeight.icon,
    borderRadius: controlHeight.icon / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urlContainer: {
    flex: 1,
    minWidth: 0,
  },
  hostText: {
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
  },
  pathWrapper: {
    fontSize: fontSize.md,
    fontFamily: 'monospace',
    fontWeight: fontWeight.medium,
  },
  pathText: {},
  queryParams: {},
  metaGroup: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
  statusText: {
    fontSize: fontSize.md,
    fontFamily: 'monospace',
    fontWeight: fontWeight.bold,
  },
  durationText: {
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
  },
  liveBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  liveBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  // Shared by "Mock this" and "Replay" — one outlined-pill treatment for both
  // co-equal detail actions, not a filled circle next to an outlined pill.
  actionPill: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
}))
