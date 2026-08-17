/**
 * SettingsPanel — inspector configuration panel.
 *
 * Exposes:
 * - maxRecords: ring buffer capacity (10–5000)
 * - maxAge: retention duration (drop entries older than N seconds; 0 = forever)
 * - redactBodyFields: comma-separated JSON body field names to mask
 * - Desktop bridge: WebSocket URL + connect/disconnect toggle via HakkaBridge
 * - Environment: device/app/network metadata
 *
 * Persistence: in-memory + optional AsyncStorage under 'hakka:rn:settings'.
 * If AsyncStorage is unavailable, settings apply for the current session only.
 *
 * All state lives in `SettingsViewModel`; this component is wiring + JSX,
 * plus the RN `Alert.alert`/`Share.share` side effects the view-model doesn't own.
 */
import { Hakka, serializeSession } from 'hakka-core'
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native'

import { getDefaultDeviceInfo } from '../../monitors/deviceInfo'
import { ArrowLeft } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import { createSettingsViewModel, RETENTION_OPTIONS } from '../viewModels'
import { SettingsDesktopRow } from './SettingsDesktopRow'
import { SettingsEnvironmentSection } from './SettingsEnvironmentSection'
import { SettingsImportModal } from './SettingsImportModal'

export interface SettingsPanelProps {
  onClose: () => void
  /** Drops every captured request. Rendered next to Session — the other control
   * on this screen that acts on the whole capture store. */
  onClearLogs?: () => void
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, onClearLogs }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [settingsVm] = useState(() => createSettingsViewModel())
  const {
    maxRecords,
    maxAge,
    redactBody,
    desktopConnect,
    desktopUrl,
    bridgeStatus,
    loaded,
    envSections,
    importVisible,
    importText,
    importStatus,
  } = useSyncExternalStore(settingsVm.subscribe, settingsVm.getSnapshot)

  useEffect(() => () => settingsVm.destroy(), [settingsVm])

  const maxRecordsInputRef = useRef<React.ElementRef<typeof TextInput>>(null)
  const redactBodyInputRef = useRef<React.ElementRef<typeof TextInput>>(null)

  // Export doesn't touch any SettingsViewModel field (just reads Hakka.getLogs() and
  // shares a string), so it stays here rather than moving to the view-model.
  const handleExportSession = useCallback(async () => {
    const logs = Hakka.getLogs()
    if (logs.length === 0) {
      Alert.alert('No Data', 'There are no captured requests to export.')
      return
    }
    try {
      const json = serializeSession(logs, { device: getDefaultDeviceInfo() })
      await Share.share({ message: json, title: `Session (${logs.length} requests).hakka` })
    } catch {
      Alert.alert('Export Failed', 'Could not export the session.')
    }
  }, [])

  const handleImportSession = useCallback(() => {
    const result = settingsVm.intents.importSession()
    if (result.status === 'ok') {
      Alert.alert('Session Imported', `Loaded ${result.count} request${result.count === 1 ? '' : 's'}.`)
    } else {
      Alert.alert('Import Failed', result.error)
    }
  }, [settingsVm])

  if (!loaded) return null

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close settings panel"
          onPress={onClose}
          style={styles.backButton}
        >
          <ArrowLeft size={20} color={colors.textMuted} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={styles.rowLabel}>
            <Text style={[styles.label, { color: colors.text }]}>Max records</Text>
            <Text style={[styles.hint, { color: colors.textSubtle }]}>Ring buffer capacity (10–5000)</Text>
          </View>
          <TextInput
            ref={maxRecordsInputRef}
            style={[
              styles.numberInput,
              { backgroundColor: colors.backgroundAlt, color: colors.text, borderColor: colors.border },
            ]}
            value={String(maxRecords)}
            onChangeText={settingsVm.intents.setMaxRecordsDraft}
            onBlur={settingsVm.intents.commitMaxRecords}
            onSubmitEditing={settingsVm.intents.commitMaxRecords}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel="Max records"
          />
        </View>

        {/* Stacked, like every other multi-control row here — a 200pt right-hand
            column wrapped the five chips to two ragged lines. */}
        <View style={[styles.stackRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Retention</Text>
          <Text style={[styles.hint, { color: colors.textSubtle }]}>Drop captures older than this</Text>
          <View style={styles.retentionPicker}>
            {RETENTION_OPTIONS.map((opt) => {
              const isActive = maxAge === opt.value
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  onPress={() => settingsVm.intents.setMaxAge(opt.value)}
                  style={[
                    styles.retentionChip,
                    {
                      backgroundColor: isActive ? colors.accent : colors.backgroundAlt,
                      borderColor: isActive ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.retentionChipText, { color: isActive ? '#fff' : colors.textMuted }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={[styles.stackRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Redact body fields</Text>
          <Text style={[styles.hint, { color: colors.textSubtle }]}>
            Mask these keys in captured JSON bodies (comma-separated, case-insensitive)
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={redactBodyInputRef}
              style={[
                styles.textInput,
                { backgroundColor: colors.backgroundAlt, color: colors.text, borderColor: colors.border },
              ]}
              value={redactBody}
              onChangeText={settingsVm.intents.setRedactBodyDraft}
              onBlur={settingsVm.intents.commitRedactBody}
              onSubmitEditing={settingsVm.intents.commitRedactBody}
              placeholder="password, token, ssn"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Redact body fields"
            />
            <Pressable
              accessibilityRole="button"
              onPress={settingsVm.intents.commitRedactBody}
              style={[styles.applyBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.applyBtnText}>Apply</Text>
            </Pressable>
          </View>
        </View>

        <SettingsDesktopRow
          desktopConnect={desktopConnect}
          desktopUrl={desktopUrl}
          bridgeStatus={bridgeStatus}
          onToggleConnect={() => settingsVm.intents.setDesktopConnect(!desktopConnect)}
          onUrlDraftChange={settingsVm.intents.setDesktopUrlDraft}
          onCommitUrl={settingsVm.intents.commitDesktopUrl}
        />

        <View style={[styles.stackRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>Session</Text>
          <Text style={[styles.hint, { color: colors.textSubtle }]}>
            Save captured requests as a portable .hakka file, or load one back in
          </Text>
          <View style={styles.inputRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export session"
              onPress={() => {
                void handleExportSession()
              }}
              style={[styles.applyBtn, styles.sessionBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.applyBtnText}>Export</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Import session"
              onPress={settingsVm.intents.openImportSession}
              style={[styles.applyBtn, styles.sessionBtn, { backgroundColor: colors.backgroundAlt }]}
            >
              <Text style={[styles.applyBtnText, { color: colors.text }]}>Import</Text>
            </Pressable>
          </View>
        </View>

        {onClearLogs && (
          <View style={[styles.stackRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text }]}>Captured requests</Text>
            <Text style={[styles.hint, { color: colors.textSubtle }]}>
              Drop everything currently in the store. This cannot be undone
            </Text>
            <View style={styles.inputRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear captured requests"
                testID="hakka-settings-clear"
                onPress={onClearLogs}
                style={({ pressed }) => [
                  styles.applyBtn,
                  styles.sessionBtn,
                  { backgroundColor: colors.chili + '14', borderWidth: 1, borderColor: colors.chili + '4D' },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={[styles.applyBtnText, { color: colors.chili }]}>Clear all</Text>
              </Pressable>
            </View>
          </View>
        )}

        <SettingsEnvironmentSection sections={envSections} onRefresh={settingsVm.intents.refreshEnvironment} />
      </ScrollView>

      <SettingsImportModal
        visible={importVisible}
        onClose={settingsVm.intents.closeImportSession}
        importText={importText}
        onImportTextChange={settingsVm.intents.setImportText}
        importStatus={importStatus}
        onImport={handleImportSession}
      />
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  headerRight: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: theme.layout.scrollBottomInset,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.md,
  },
  stackRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.sm,
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
  numberInput: {
    width: 72,
    height: theme.controlHeight.field,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.fontSize.md,
    textAlign: 'right',
  },
  retentionPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  retentionChip: {
    height: theme.controlHeight.chip,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retentionChipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
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
  sessionBtn: {
    flex: 1,
    alignItems: 'center',
  },
}))
