/**
 * SettingsDesktopRow — the desktop-bridge toggle, connection status line, and
 * WebSocket URL field. Connection state lives in `SettingsViewModel` /
 * `HakkaBridge`; this is presentation + the URL `TextInput`'s local ref.
 */
import type { ConnectionStatus } from 'hakka-core'
import React, { useRef } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { createStyleSheet, useTheme } from '../styles'
import { DEFAULT_DESKTOP_URL } from '../viewModels'

function statusLabel(s: ConnectionStatus): string {
  switch (s.state) {
    case 'connected':
      return `Connected to ${s.url}`
    case 'connecting':
      return `Connecting to ${s.url}…`
    case 'error':
      return `Error: ${s.error ?? 'Unknown'}`
    default:
      return 'Disconnected'
  }
}

export interface SettingsDesktopRowProps {
  desktopConnect: boolean
  desktopUrl: string
  bridgeStatus: ConnectionStatus
  onToggleConnect: () => void
  onUrlDraftChange: (text: string) => void
  onCommitUrl: () => void
}

export const SettingsDesktopRow: React.FC<SettingsDesktopRowProps> = ({
  desktopConnect,
  desktopUrl,
  bridgeStatus,
  onToggleConnect,
  onUrlDraftChange,
  onCommitUrl,
}) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const desktopUrlInputRef = useRef<React.ElementRef<typeof TextInput>>(null)

  const statusColor = (() => {
    switch (bridgeStatus.state) {
      case 'connected':
        return colors.success
      case 'connecting':
        return colors.warning
      case 'error':
        return colors.error
      default:
        return colors.textMuted
    }
  })()

  return (
    <View style={[styles.stackRow, { borderBottomColor: colors.border }]}>
      <View style={styles.rowInline}>
        <View style={styles.rowLabel}>
          <Text style={[styles.label, { color: colors.text }]}>Connect to desktop</Text>
          <Text style={[styles.hint, { color: colors.textSubtle }]}>Stream captures to the Hakka desktop app</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: desktopConnect }}
          accessibilityLabel="Toggle desktop connection"
          onPress={onToggleConnect}
          style={[
            styles.toggle,
            {
              backgroundColor: desktopConnect ? colors.accent : colors.backgroundAlt,
              borderColor: desktopConnect ? colors.accent : colors.border,
            },
          ]}
        >
          <View style={[styles.toggleThumb, { transform: [{ translateX: desktopConnect ? 16 : 2 }] }]} />
        </Pressable>
      </View>

      <Text style={[styles.statusLine, { color: statusColor }]}>{statusLabel(bridgeStatus)}</Text>

      <View style={styles.inputRow}>
        <TextInput
          ref={desktopUrlInputRef}
          style={[
            styles.textInput,
            {
              backgroundColor: colors.backgroundAlt,
              color: colors.text,
              borderColor: colors.border,
              fontFamily: 'monospace',
            },
          ]}
          value={desktopUrl}
          onChangeText={onUrlDraftChange}
          onBlur={onCommitUrl}
          onSubmitEditing={onCommitUrl}
          placeholder={DEFAULT_DESKTOP_URL}
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          accessibilityLabel="Desktop WebSocket URL"
        />
        <Pressable
          accessibilityRole="button"
          onPress={onCommitUrl}
          style={[styles.applyBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={styles.applyBtnText}>Apply</Text>
        </Pressable>
      </View>
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  stackRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.sm,
  },
  rowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  rowLabel: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  label: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
  },
  toggle: {
    width: 40,
    height: theme.controlHeight.chip,
    borderRadius: theme.controlHeight.chip / 2,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 18,
    height: theme.controlHeight.badge,
    borderRadius: theme.controlHeight.badge / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  statusLine: {
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  textInput: {
    flex: 1,
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.fontSize.sm,
  },
  applyBtn: {
    height: theme.controlHeight.field,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
  },
  applyBtnText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: '#fff',
  },
}))
