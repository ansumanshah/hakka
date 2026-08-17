/**
 * SettingsEnvironmentSection — device/app/network facts, grouped into
 * titled cards. Data comes from `SettingsViewModel`'s `envSections`; this
 * file is purely presentational.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../styles'
import type { InfoSection } from '../viewModels'

export interface SettingsEnvironmentSectionProps {
  sections: InfoSection[]
  onRefresh: () => void
}

export const SettingsEnvironmentSection: React.FC<SettingsEnvironmentSectionProps> = ({ sections, onRefresh }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  return (
    <>
      <View style={styles.envHeader}>
        <Text style={[styles.envTitle, { color: colors.textSubtle }]}>ENVIRONMENT</Text>
        <Pressable accessibilityRole="button" onPress={onRefresh}>
          <Text style={[styles.envRefresh, { color: colors.accent }]}>Refresh</Text>
        </Pressable>
      </View>
      {sections.map((section) => (
        <View key={section.title} style={[styles.envSection, { borderColor: colors.border }]}>
          <Text style={[styles.envSectionTitle, { color: colors.textMuted }]}>{section.title}</Text>
          {section.rows.map((row, index) => (
            <View
              key={row.label}
              style={[
                styles.envRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: index < section.rows.length - 1 ? StyleSheet.hairlineWidth : 0,
                },
              ]}
            >
              <Text style={[styles.envLabel, { color: colors.textMuted }]} numberOfLines={1}>
                {row.label}
              </Text>
              <Text style={[styles.envValue, { color: colors.text }]} selectable numberOfLines={2}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </>
  )
}

const createStyles = createStyleSheet((theme) => ({
  envHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.sm,
  },
  envTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  envRefresh: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  envSection: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  envSectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  envRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.md,
  },
  envLabel: {
    width: 110,
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  envValue: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
}))
