/** StorageViewerRow — a single key/value row in StorageViewer's list. */
import React, { memo, useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'

import { Trash2 } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import type { StorageEntry } from './StorageViewerState'

export interface StorageViewerRowProps {
  item: StorageEntry
  onSelect: (key: string) => void
  onDelete: (key: string) => void
}

const ROW_DELETE_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

export const StorageViewerRow = memo(({ item, onSelect, onDelete }: StorageViewerRowProps) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const handleSelect = useCallback(() => onSelect(item.key), [item.key, onSelect])
  const handleDelete = useCallback(() => onDelete(item.key), [item.key, onDelete])

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={handleSelect}
    >
      <View style={styles.rowContent}>
        <Text style={[styles.keyText, { color: colors.text }]} numberOfLines={1}>
          {item.key}
        </Text>
        <Text style={[styles.valuePreview, { color: colors.textMuted }]} numberOfLines={1}>
          {truncate(item.value, 60)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.deleteBtn}
        onPress={handleDelete}
        hitSlop={ROW_DELETE_HIT_SLOP}
      >
        <Trash2 size={14} color={colors.error ?? '#ef4444'} />
      </Pressable>
    </Pressable>
  )
})

StorageViewerRow.displayName = 'StorageViewerRow'

const createStyles = createStyleSheet((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    borderBottomWidth: 1,
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing.xxs,
  },
  keyText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
  valuePreview: {
    fontSize: theme.fontSize.sm,
  },
  deleteBtn: {
    width: theme.controlHeight.icon,
    height: theme.controlHeight.icon,
    borderRadius: theme.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing.md,
  },
}))
