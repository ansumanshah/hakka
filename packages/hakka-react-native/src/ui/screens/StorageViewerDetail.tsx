/** StorageViewerDetail — the selected-key detail/edit view in StorageViewer. */
import React, { useCallback } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { ArrowLeft, Trash2 } from '../icons'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'
import type { StorageEntry } from './StorageViewerState'

export interface StorageViewerDetailProps {
  selectedEntry: StorageEntry
  prettyValue: string
  isEditing: boolean
  editValue: string
  onBack: () => void
  onStartEdit: () => void
  onDelete: (key: string) => void
  onSave: () => void
  onCancelEdit: () => void
  onEditValueChange: (value: string) => void
}

function StorageViewerDetailInner({
  selectedEntry,
  prettyValue,
  isEditing,
  editValue,
  onBack,
  onStartEdit,
  onDelete,
  onSave,
  onCancelEdit,
  onEditValueChange,
}: StorageViewerDetailProps) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const handleDelete = useCallback(() => onDelete(selectedEntry.key), [onDelete, selectedEntry.key])

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to storage list"
          style={styles.backBtn}
          onPress={onBack}
        >
          <ArrowLeft size={18} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {selectedEntry.key}
        </Text>
        <View style={styles.headerActions}>
          {!isEditing && (
            <Pressable accessibilityRole="button" style={styles.actionBtn} onPress={onStartEdit}>
              <Text style={[styles.actionText, { color: colors.accent }]}>Edit</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" style={styles.actionBtn} onPress={handleDelete}>
            <Trash2 size={16} color={colors.error} />
          </Pressable>
        </View>
      </View>

      {isEditing ? (
        <View style={styles.editContainer}>
          <TextInput
            style={[
              styles.editInput,
              {
                backgroundColor: colors.backgroundAlt,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            value={editValue}
            onChangeText={onEditValueChange}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.editButtons}>
            <Pressable
              accessibilityRole="button"
              style={[styles.editBtn, { backgroundColor: colors.backgroundAlt }]}
              onPress={onCancelEdit}
            >
              <Text style={[styles.editBtnText, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.editBtn, { backgroundColor: colors.accent }]}
              onPress={onSave}
            >
              <Text style={[styles.editBtnText, { color: '#fff' }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.valueContainer, { backgroundColor: colors.backgroundAlt }]}>
          <Text style={[styles.valueText, { color: colors.text }]} selectable>
            {prettyValue}
          </Text>
        </View>
      )}
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  backBtn: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    borderRadius: theme.radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  actionText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
  valueContainer: {
    flex: 1,
    margin: theme.spacing.lg,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  valueText: {
    fontSize: theme.fontSize.md,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  editContainer: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  editInput: {
    flex: 1,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.spacing.lg,
    fontSize: theme.fontSize.md,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  editButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'flex-end',
  },
  editBtn: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  editBtnText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
}))

export const StorageViewerDetail = React.memo(StorageViewerDetailInner)
