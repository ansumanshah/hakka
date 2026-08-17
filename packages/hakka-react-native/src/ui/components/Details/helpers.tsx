import { buildCurl } from 'hakka-core'
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { copyToClipboard } from '../../../utils/clipboard'
import { Copy } from '../../icons'
import { createStyleSheet, type Theme } from '../../styles/createStyleSheet'

export const formatDuration = (duration?: number) => {
  if (!duration) return '-'
  return duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(2)}s`
}

export { buildCurl }

const highlightText = (text: string, query: string, theme: Theme) => {
  if (!query.trim()) return text
  const sharedStyles = createSharedStyles(theme)
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  let offset = 0
  return parts.map((part) => {
    const key = `${offset}-${part}`
    offset += part.length
    return part.toLowerCase() === query.toLowerCase() ? (
      <Text key={key} style={sharedStyles.highlight}>
        {part}
      </Text>
    ) : (
      part
    )
  })
}

interface KeyValueListProps {
  data: Record<string, string | number | undefined> | [string, string][]
  searchQuery?: string
  theme: Theme
}

export const KeyValueList: React.FC<KeyValueListProps> = ({ data, searchQuery = '', theme }) => {
  const sharedStyles = createSharedStyles(theme)
  const entries = Array.isArray(data) ? data : Object.entries(data)

  if (entries.length === 0) {
    return <Text style={sharedStyles.nullText}>null</Text>
  }

  const filtered = searchQuery.trim()
    ? entries.filter(([k, v]) => {
        const key = String(k).toLowerCase()
        const value = String(v || '').toLowerCase()
        const query = searchQuery.toLowerCase()
        return key.includes(query) || value.includes(query)
      })
    : entries

  if (filtered.length === 0) {
    return <Text style={sharedStyles.emptyText}>No results</Text>
  }

  return filtered.map(([key, value]) => (
    <View key={key} style={sharedStyles.headerRow}>
      <Text style={sharedStyles.headerKey} selectable>
        {highlightText(String(key), searchQuery, theme)}
      </Text>
      <Text style={sharedStyles.headerValue} selectable>
        {highlightText(String(value || 'null'), searchQuery, theme)}
      </Text>
    </View>
  ))
}

interface SectionHeaderProps {
  title: string
  content?: string
  viewMode?: 'tree' | 'raw'
  onViewModeChange?: (mode: 'tree' | 'raw') => void
  theme: Theme
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, content, viewMode, onViewModeChange, theme }) => {
  const sharedStyles = createSharedStyles(theme)

  return (
    <View style={sharedStyles.sectionHeader}>
      <Text style={sharedStyles.sectionTitle}>{title}</Text>
      <View style={sharedStyles.headerActions}>
        {viewMode && onViewModeChange && (
          <View style={sharedStyles.toggleGroup}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onViewModeChange('tree')}
              style={[sharedStyles.toggleBtn, viewMode === 'tree' && sharedStyles.toggleBtnActive]}
            >
              <Text style={[sharedStyles.toggleText, viewMode === 'tree' && sharedStyles.toggleTextActive]}>Tree</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onViewModeChange('raw')}
              style={[sharedStyles.toggleBtn, viewMode === 'raw' && sharedStyles.toggleBtnActive]}
            >
              <Text style={[sharedStyles.toggleText, viewMode === 'raw' && sharedStyles.toggleTextActive]}>Raw</Text>
            </Pressable>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          style={sharedStyles.actionBtn}
          onPress={() => copyToClipboard(content || 'null')}
          disabled={!content}
        >
          <Copy size={12} color={theme.colors.textMuted} />
        </Pressable>
      </View>
    </View>
  )
}

// Note: Color properties should be applied inline using useTheme()

export const createSharedStyles = createStyleSheet(({ colors, spacing, radius, fontSize, fontWeight }) => ({
  section: {
    marginBottom: spacing.xl,
  },
  // Flush with the pane's own horizontal inset (Details.tsx scrollContent) —
  // no second inset here, so section titles and KV rows align to one edge.
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    color: colors.textSubtle,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  toggleBtnActive: {
    backgroundColor: colors.accent,
  },
  toggleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
  },
  toggleTextActive: {
    color: colors.background,
  },
  actionBtn: {
    padding: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  // Shrink-to-fit: `flexShrink: 0` on a `flex-start` row keeps the key column
  // sized to its own content instead of a fixed percentage, so the value gets
  // every pixel the key doesn't need — on every screen width.
  headerKey: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    fontFamily: 'monospace',
    flexShrink: 0,
    paddingRight: spacing.md,
  },
  headerValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
    flex: 1,
  },
  codeBlock: {
    fontSize: fontSize.sm,
    fontFamily: 'monospace',
    padding: spacing.md,
    lineHeight: 17,
    borderRadius: radius.md,
  },
  jsonKey: {
    fontWeight: fontWeight.semibold,
    color: colors.codeKey,
  },
  jsonValue: {
    color: colors.codeText,
  },
  jsonPunctuation: {
    color: colors.codePunctuation,
  },
  jsonIndent: {
    color: 'transparent',
  },
  nullText: {
    color: colors.textSubtle,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    fontFamily: 'monospace',
    paddingVertical: spacing.xs,
  },
  emptyText: {
    color: colors.textSubtle,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },
  highlight: {
    fontWeight: fontWeight.bold,
    backgroundColor: colors.codeHighlight,
    color: colors.text,
  },
}))
