/**
 * BreakpointsPausedCard — the paused-request/paused-response editor card
 * rendered inside BreakpointsPanel's "Paused" section while a request is held.
 */
import type { PausedEntry, PausedRequest, PausedResponse } from 'hakka-core'
import React, { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { MethodChip } from '../components/Badge'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'

function headersToText(h: Record<string, string>): string {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function textToHeaders(t: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of t.split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    if (!k) continue
    out[k] = line.slice(i + 1).trim()
  }
  return out
}

interface PausedCardProps {
  entry: PausedEntry
  onResume: (id: string, edits: Partial<PausedRequest> | Partial<PausedResponse>) => void
  onAbort: (id: string) => void
}

function PausedRequestCard({
  entry,
  onResume,
  onAbort,
}: PausedCardProps & { entry: Extract<PausedEntry, { phase: 'request' }> }) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [editUrl, setEditUrl] = useState(entry.request.url)
  const [editBody, setEditBody] = useState(entry.request.body ?? '')

  const handleResume = useCallback(() => {
    onResume(entry.id, { url: editUrl, body: editBody || null })
  }, [entry.id, editUrl, editBody, onResume])

  const handleAbort = useCallback(() => {
    onAbort(entry.id)
  }, [entry.id, onAbort])

  return (
    <View style={[styles.pausedCard, { backgroundColor: colors.backgroundAlt, borderColor: colors.warning }]}>
      <View style={styles.pausedRow}>
        <MethodChip method={entry.request.method} width={46} />
        <TextInput
          accessibilityLabel="Edit paused URL"
          value={editUrl}
          onChangeText={setEditUrl}
          style={[
            styles.urlInput,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
        />
      </View>

      {Object.keys(entry.request.headers).length > 0 && (
        <View>
          <Text style={[styles.fieldLabel, { color: colors.textSubtle }]}>Headers (read-only)</Text>
          <ScrollView
            style={[styles.headersBox, { backgroundColor: colors.background, borderColor: colors.border }]}
            nestedScrollEnabled
          >
            {Object.entries(entry.request.headers).map(([k, v]) => (
              <View key={k} style={styles.headerRow}>
                <Text style={[styles.headerKey, { color: colors.textMuted }]} numberOfLines={1}>
                  {k}:
                </Text>
                <Text style={[styles.headerValue, { color: colors.text }]} numberOfLines={1}>
                  {v}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textSubtle }]}>Body</Text>
        <TextInput
          accessibilityLabel="Edit paused body"
          value={editBody}
          onChangeText={setEditBody}
          style={[
            styles.bodyInput,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
          ]}
          multiline
          placeholder="(empty)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={[styles.editNote, { color: colors.textMuted }]}>
        Edits to URL and body are applied to the outgoing request on Resume.
      </Text>

      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abort paused request"
          onPress={handleAbort}
          style={({ pressed }) => [styles.abortBtn, { backgroundColor: colors.error }, pressed && { opacity: 0.74 }]}
        >
          <Text style={styles.actionBtnText}>Abort</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume paused request"
          onPress={handleResume}
          style={({ pressed }) => [styles.resumeBtn, { backgroundColor: colors.success }, pressed && { opacity: 0.74 }]}
        >
          <Text style={styles.actionBtnText}>Resume</Text>
        </Pressable>
      </View>
    </View>
  )
}

function PausedResponseCard({
  entry,
  onResume,
  onAbort,
}: PausedCardProps & { entry: Extract<PausedEntry, { phase: 'response' }> }) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [editStatus, setEditStatus] = useState(String(entry.response.status))
  const [editHeaders, setEditHeaders] = useState(headersToText(entry.response.headers))
  const [editBody, setEditBody] = useState(entry.response.body)

  const handleResume = useCallback(() => {
    onResume(entry.id, {
      status: Number(editStatus) || entry.response.status,
      headers: textToHeaders(editHeaders),
      body: editBody,
    })
  }, [entry.id, entry.response.status, editStatus, editHeaders, editBody, onResume])

  const handleAbort = useCallback(() => {
    onAbort(entry.id)
  }, [entry.id, onAbort])

  return (
    <View style={[styles.pausedCard, { backgroundColor: colors.backgroundAlt, borderColor: colors.warning }]}>
      <View style={styles.pausedRow}>
        <View style={[styles.resBadge, { backgroundColor: colors.textMuted }]}>
          <Text style={styles.methodBadgeText}>RES</Text>
        </View>
        <TextInput
          accessibilityLabel="Edit paused status"
          value={editStatus}
          onChangeText={setEditStatus}
          keyboardType="number-pad"
          style={[
            styles.urlInput,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
          ]}
          selectTextOnFocus
        />
      </View>

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textSubtle }]}>Response headers</Text>
        <TextInput
          accessibilityLabel="Edit paused response headers"
          value={editHeaders}
          onChangeText={setEditHeaders}
          style={[
            styles.bodyInput,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
          ]}
          multiline
          placeholder="(none)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View>
        <Text style={[styles.fieldLabel, { color: colors.textSubtle }]}>Response body</Text>
        <TextInput
          accessibilityLabel="Edit paused response body"
          value={editBody}
          onChangeText={setEditBody}
          style={[
            styles.bodyInput,
            { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
          ]}
          multiline
          placeholder="(empty)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <Text style={[styles.editNote, { color: colors.textMuted }]}>
        Edits to status, headers, and body are applied to the response the caller receives on Resume.
      </Text>

      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abort paused response"
          onPress={handleAbort}
          style={({ pressed }) => [styles.abortBtn, { backgroundColor: colors.error }, pressed && { opacity: 0.74 }]}
        >
          <Text style={styles.actionBtnText}>Abort</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume paused response"
          onPress={handleResume}
          style={({ pressed }) => [styles.resumeBtn, { backgroundColor: colors.success }, pressed && { opacity: 0.74 }]}
        >
          <Text style={styles.actionBtnText}>Resume</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function PausedCard(props: PausedCardProps) {
  if (props.entry.phase === 'response') {
    return (
      <PausedResponseCard
        entry={props.entry as Extract<PausedEntry, { phase: 'response' }>}
        onResume={props.onResume}
        onAbort={props.onAbort}
      />
    )
  }
  return (
    <PausedRequestCard
      entry={props.entry as Extract<PausedEntry, { phase: 'request' }>}
      onResume={props.onResume}
      onAbort={props.onAbort}
    />
  )
}

const createStyles = createStyleSheet((theme) => ({
  pausedCard: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  pausedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  resBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radius.sm,
    minWidth: 44,
    alignItems: 'center',
  },
  methodBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '700' as const,
    color: '#fff',
    fontFamily: 'monospace',
  },
  urlInput: {
    flex: 1,
    height: theme.controlHeight.field,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
  headersBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    maxHeight: 80,
  },
  headerRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  headerKey: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  headerValue: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    flex: 1,
  },
  bodyInput: {
    minHeight: 60, // ui-token-check-ignore: multi-line rule body input
    maxHeight: 120,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  fieldLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  editNote: {
    fontSize: theme.fontSize.xs,
    fontStyle: 'italic',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
  },
  abortBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  resumeBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  actionBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: '#fff',
  },
}))
