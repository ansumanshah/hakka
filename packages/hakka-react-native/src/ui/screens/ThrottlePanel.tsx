/**
 * ThrottlePanel — network-conditions control panel for the RN inspector.
 * Mirrors web ThrottleTab (packages/hakka-browser/src/ui/ThrottleTab.tsx).
 * Uses ThrottleEngine from hakka-core; subscribes to onChange for live sync.
 */
import { ThrottleEngine } from 'hakka-core'
import type { ThrottleConfig, ThrottleProfile } from 'hakka-core'
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ArrowLeft } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'

interface ProfileMeta {
  profile: Exclude<ThrottleProfile, 'custom'>
  label: string
}

const PROFILES: ProfileMeta[] = [
  { profile: 'none', label: 'None' },
  { profile: 'fast-3g', label: 'Fast 3G' },
  { profile: 'slow-3g', label: 'Slow 3G' },
  { profile: 'edge', label: 'Edge' },
  { profile: 'offline', label: 'Offline' },
]

function profileLabel(profile: ThrottleProfile): string {
  switch (profile) {
    case 'none':
      return 'None'
    case 'fast-3g':
      return 'Fast 3G'
    case 'slow-3g':
      return 'Slow 3G'
    case 'edge':
      return 'Edge'
    case 'offline':
      return 'Offline'
    case 'custom':
      return 'Custom'
  }
}

export interface ThrottlePanelProps {
  onClose: () => void
  /** Hide the panel's own back/title header — used when embedded under the
   * merged Rules screen's shared header + segmented switch. Default true. */
  showHeader?: boolean
}

export const ThrottlePanel: React.FC<ThrottlePanelProps> = ({ onClose, showHeader = true }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  // Seed from current state; onChange does NOT fire immediately on subscribe.
  const [config, setConfig] = useState<ThrottleConfig>(() => ThrottleEngine.current)

  useEffect(() => {
    const off = ThrottleEngine.onChange((cfg) => setConfig(cfg))
    return off
  }, [])

  const handleProfilePress = useCallback((profile: ThrottleProfile) => {
    ThrottleEngine.setProfile(profile)
  }, [])

  const isOffline = ThrottleEngine.isOffline

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {showHeader && (
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
            <ArrowLeft size={20} color={colors.textMuted} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Network Throttle</Text>
          <View style={styles.headerRight} />
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>PROFILE</Text>
          <View style={styles.chipRow}>
            {PROFILES.map((meta) => {
              const isActive = config.profile === meta.profile
              return (
                <Pressable
                  key={meta.profile}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`Set throttle profile: ${meta.label}`}
                  onPress={() => handleProfilePress(meta.profile)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: isActive ? colors.accent : colors.backgroundAlt,
                      borderColor: isActive ? colors.accent : colors.border,
                    },
                    pressed && { opacity: 0.74 },
                  ]}
                >
                  <Text style={[styles.chipText, { color: isActive ? '#fff' : colors.textMuted }]}>{meta.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={[styles.section, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSubtle }]}>CURRENT CONDITIONS</Text>

          <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textMuted }]}>Profile</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>{profileLabel(config.profile)}</Text>
          </View>

          <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textMuted }]}>Latency</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>{config.latencyMs ?? 0} ms</Text>
          </View>

          <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.kvKey, { color: colors.textMuted }]}>Download</Text>
            <Text style={[styles.kvValue, { color: colors.text }]}>
              {(config.downloadKbps ?? 0) > 0 ? `${config.downloadKbps} kbps` : '—'}
            </Text>
          </View>

          {isOffline && (
            <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.kvKey, { color: colors.textMuted }]}>Status</Text>
              <View style={[styles.offlineBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.offlineBadgeText}>OFFLINE</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.noteSection}>
          <Text style={[styles.note, { color: colors.textSubtle }]}>
            Throttling adds artificial latency and bandwidth limits to fetch/XHR, simulating slow network conditions.
          </Text>
        </View>
      </ScrollView>
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
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kvKey: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontFamily: 'monospace',
  },
  kvValue: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
  offlineBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radius.sm,
  },
  offlineBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: '#fff',
  },
  noteSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
  },
  note: {
    fontSize: theme.fontSize.xs,
    fontStyle: 'italic',
    lineHeight: 18,
  },
}))
