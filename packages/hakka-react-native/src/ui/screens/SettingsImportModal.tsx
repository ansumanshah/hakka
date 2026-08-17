/**
 * SettingsImportModal — paste a .hakka session JSON string, then
 * deserializeSession + Hakka.ingest each request. Import parsing itself lives
 * in `SettingsViewModel`; this is presentation + the modal shell.
 */
import React from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { X } from '../icons'
import { createStyleSheet, useTheme } from '../styles'

export interface SettingsImportModalProps {
  visible: boolean
  onClose: () => void
  importText: string
  onImportTextChange: (text: string) => void
  importStatus: 'idle' | 'error'
  onImport: () => void
}

export const SettingsImportModal: React.FC<SettingsImportModalProps> = ({
  visible,
  onClose,
  importText,
  onImportTextChange,
  importStatus,
  onImport,
}) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.importOverlay}>
        <View style={[styles.importSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.importTitleBar, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Import Session</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
              <X size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={[styles.hint, { color: colors.textSubtle, paddingHorizontal: theme.spacing.lg }]}>
            Paste a .hakka session JSON (from Export, above, or the desktop/web app)
          </Text>
          <TextInput
            style={[
              styles.importInput,
              {
                color: colors.text,
                borderColor: importStatus === 'error' ? colors.error : colors.border,
                backgroundColor: colors.backgroundAlt,
              },
            ]}
            value={importText}
            onChangeText={onImportTextChange}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder='{"hakkaSession": 1, "requests": [...]}'
            placeholderTextColor={colors.textSubtle}
          />
          <View style={[styles.importFooter, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onImport}
              disabled={!importText.trim()}
              style={[
                styles.applyBtn,
                styles.sessionBtn,
                { backgroundColor: colors.accent, opacity: importText.trim() ? 1 : 0.5 },
              ]}
            >
              <Text style={styles.applyBtnText}>Import</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const createStyles = createStyleSheet((theme) => ({
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    lineHeight: 15,
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
  sessionBtn: {
    flex: 1,
    alignItems: 'center',
  },
  importOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  importSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    maxHeight: '80%',
  },
  importTitleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  importInput: {
    margin: theme.spacing.lg,
    minHeight: 180, // ui-token-check-ignore: import-session paste area
    maxHeight: 320,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    textAlignVertical: 'top',
  },
  importFooter: {
    padding: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
}))
