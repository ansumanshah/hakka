import React, { memo } from 'react'
import { Pressable, Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { CopyButton } from '../CopyButton'
import { SearchHighlighter } from '../SearchHighlighter'
import { copyToClipboard, getItemCount } from './utils'

type JsonViewerTheme = ReturnType<typeof useTheme>

/** Tree view for JSON with collapsible nodes. */

interface TreeViewProps {
  data: unknown
  searchQuery: string
  collapsed: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  theme?: JsonViewerTheme
  onExpandAll: () => void
  onCollapseAll: () => void
}

export const TreeView: React.FC<TreeViewProps> = ({
  data,
  searchQuery,
  collapsed,
  onToggleCollapse,
  theme: customTheme,
  onExpandAll,
  onCollapseAll,
}) => {
  const fallbackTheme = useTheme()
  const theme = customTheme || fallbackTheme
  const styles = createStyles(theme)

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <NodeRenderer
        value={data}
        path="root"
        isRoot={true}
        searchQuery={searchQuery}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        theme={theme}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
      />
    </View>
  )
}

interface NodeRendererProps {
  value: unknown
  path: string
  isRoot: boolean
  searchQuery: string
  collapsed: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  theme: JsonViewerTheme
  onExpandAll?: () => void
  onCollapseAll?: () => void
}

const NodeRenderer = memo<NodeRendererProps>(
  ({ value, path, isRoot, searchQuery, collapsed, onToggleCollapse, theme, onExpandAll, onCollapseAll }) => {
    if (value === null) {
      return <NullValue theme={theme} />
    }

    if (typeof value === 'boolean') {
      return <BooleanValue value={value} theme={theme} />
    }

    if (typeof value === 'number') {
      return <NumberValue value={value} theme={theme} />
    }

    if (typeof value === 'string') {
      return <StringValue value={value} searchQuery={searchQuery} theme={theme} />
    }

    if (Array.isArray(value)) {
      return (
        <ArrayNode
          value={value}
          path={path}
          isRoot={isRoot}
          searchQuery={searchQuery}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          theme={theme}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
        />
      )
    }

    if (typeof value === 'object') {
      return (
        <ObjectNode
          value={value as Record<string, unknown>}
          path={path}
          isRoot={isRoot}
          searchQuery={searchQuery}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          theme={theme}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
        />
      )
    }

    return (
      <Text style={[{ fontSize: theme.fontSize.sm }, { color: theme.colors.codePunctuation }]}>{String(value)}</Text>
    )
  },
)
NodeRenderer.displayName = 'NodeRenderer'

// Module-scope stylesheet factories — WeakMap cache keyed on theme hits every render
const createNullStyles = createStyleSheet((theme: JsonViewerTheme) => ({
  null: { fontSize: theme.fontSize.sm, color: theme.colors.codeNull },
}))
const createBooleanStyles = createStyleSheet((theme: JsonViewerTheme) => ({
  boolean: { fontSize: theme.fontSize.sm, color: theme.colors.codeBoolean },
}))
const createNumberStyles = createStyleSheet((theme: JsonViewerTheme) => ({
  number: { fontSize: theme.fontSize.sm, color: theme.colors.codeNumber },
}))
const createStringStyles = createStyleSheet((theme: JsonViewerTheme) => ({
  stringContainer: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  string: { fontSize: theme.fontSize.sm, color: theme.colors.codeString },
}))

const NullValue = memo(({ theme }: { theme: JsonViewerTheme }) => {
  const styles = createNullStyles(theme)
  return <Text style={styles.null}>null</Text>
})
NullValue.displayName = 'NullValue'

const BooleanValue = memo(({ value, theme }: { value: boolean; theme: JsonViewerTheme }) => {
  const styles = createBooleanStyles(theme)
  return <Text style={styles.boolean}>{String(value)}</Text>
})
BooleanValue.displayName = 'BooleanValue'

const NumberValue = memo(({ value, theme }: { value: number; theme: JsonViewerTheme }) => {
  const styles = createNumberStyles(theme)
  return <Text style={styles.number}>{value}</Text>
})
NumberValue.displayName = 'NumberValue'

const StringValue = memo(
  ({ value, searchQuery, theme }: { value: string; searchQuery: string; theme: JsonViewerTheme }) => {
    const styles = createStringStyles(theme)
    return (
      <View style={styles.stringContainer}>
        <Text style={styles.string}>
          &quot;
          <SearchHighlighter
            text={value}
            query={searchQuery}
            highlightColor={theme.colors.codeString}
            backgroundColor={theme.colors.codeHighlight}
          />
          &quot;
        </Text>
        <CopyButton onCopy={() => copyToClipboard(value)} color={theme.colors.textMuted} />
      </View>
    )
  },
)
StringValue.displayName = 'StringValue'

interface ArrayNodeProps {
  value: unknown[]
  path: string
  isRoot: boolean
  searchQuery: string
  collapsed: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  theme: JsonViewerTheme
  onExpandAll?: () => void
  onCollapseAll?: () => void
}

const ArrayNode = memo<ArrayNodeProps>(
  ({ value, path, isRoot, searchQuery, collapsed, onToggleCollapse, theme, onExpandAll, onCollapseAll }) => {
    const isCollapsed = collapsed[path] !== false
    const nestingLevel = path.split('.').length - 1
    const { count, label } = getItemCount(value)

    if (count === 0) {
      return <Text style={[{ fontSize: theme.fontSize.sm }, { color: theme.colors.codePunctuation }]}>[]</Text>
    }

    return (
      <View>
        <CollapsibleHeader
          isCollapsed={isCollapsed}
          path={path}
          onToggle={onToggleCollapse}
          icon="["
          count={count}
          label={label}
          isRoot={isRoot}
          theme={theme}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
        />
        {!isCollapsed && (
          <View style={[{ paddingLeft: 0 }, { marginLeft: nestingLevel * 10 }]}>
            {value.map((item, index) => {
              const childPath = `${path}.${index}`

              return (
                <View
                  key={`array-item:${childPath}`}
                  style={{ flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingVertical: 1 }}
                >
                  <Text style={[{ fontSize: theme.fontSize.sm }, { color: theme.colors.textMuted }]}>{index}: </Text>
                  <NodeRenderer
                    value={item}
                    path={childPath}
                    isRoot={false}
                    searchQuery={searchQuery}
                    collapsed={collapsed}
                    onToggleCollapse={onToggleCollapse}
                    theme={theme}
                  />
                </View>
              )
            })}
          </View>
        )}
      </View>
    )
  },
)
ArrayNode.displayName = 'ArrayNode'

interface ObjectNodeProps {
  value: Record<string, unknown>
  path: string
  isRoot: boolean
  searchQuery: string
  collapsed: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  theme: JsonViewerTheme
  onExpandAll?: () => void
  onCollapseAll?: () => void
}

const ObjectNode = memo<ObjectNodeProps>(
  ({ value, path, isRoot, searchQuery, collapsed, onToggleCollapse, theme, onExpandAll, onCollapseAll }) => {
    const isCollapsed = collapsed[path] !== false
    const nestingLevel = path.split('.').length - 1
    const keys = Object.keys(value)
    const { count, label } = getItemCount(value)

    if (count === 0) {
      return <Text style={[{ fontSize: theme.fontSize.sm }, { color: theme.colors.codePunctuation }]}>{'{}'}</Text>
    }

    return (
      <View>
        <CollapsibleHeader
          isCollapsed={isCollapsed}
          path={path}
          onToggle={onToggleCollapse}
          icon="{"
          count={count}
          label={label}
          isRoot={isRoot}
          theme={theme}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
        />
        {!isCollapsed && (
          <View style={[{ paddingLeft: 0 }, { marginLeft: nestingLevel * 10 }]}>
            {keys.map((k) => (
              <View key={k} style={{ flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingVertical: 1 }}>
                <Text
                  style={[{ fontSize: theme.fontSize.sm, fontWeight: '600' as const }, { color: theme.colors.codeKey }]}
                >
                  &quot;
                  <SearchHighlighter
                    text={k}
                    query={searchQuery}
                    highlightColor={theme.colors.codeKey}
                    backgroundColor={theme.colors.codeHighlight}
                  />
                  &quot;:{' '}
                </Text>
                <NodeRenderer
                  value={value[k]}
                  path={`${path}.${k}`}
                  isRoot={false}
                  searchQuery={searchQuery}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  theme={theme}
                />
              </View>
            ))}
          </View>
        )}
      </View>
    )
  },
)
ObjectNode.displayName = 'ObjectNode'

interface CollapsibleHeaderProps {
  isCollapsed: boolean
  path: string
  onToggle: (path: string) => void
  icon: string
  count: number
  label: string
  isRoot: boolean
  theme: JsonViewerTheme
  onExpandAll?: () => void
  onCollapseAll?: () => void
}

const CollapsibleHeader = memo<CollapsibleHeaderProps>(
  ({ isCollapsed, path, onToggle, icon, count, label, isRoot, theme, onExpandAll, onCollapseAll }) => (
    <View
      style={{
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        paddingVertical: 1,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <Pressable onPress={() => onToggle(path)} style={({ pressed }) => [{ padding: 2 }, pressed && { opacity: 0.7 }]}>
        <Text style={[{ fontSize: theme.fontSize.sm }, { color: theme.colors.codePunctuation }]}>
          {isCollapsed ? '▶' : '▼'} {icon} {count} {label} {icon === '{' ? '}' : ']'}
        </Text>
      </Pressable>
      {isRoot && (
        <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 }}>
          {onExpandAll && (
            <Pressable
              onPress={onExpandAll}
              style={({ pressed }) => [
                { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, opacity: pressed ? 0.7 : 1 },
                { backgroundColor: theme.colors.backgroundAlt },
              ]}
            >
              <Text
                style={[{ fontSize: theme.fontSize.sm, fontWeight: '500' as const }, { color: theme.colors.textMuted }]}
              >
                ▼ Expand
              </Text>
            </Pressable>
          )}
          {onCollapseAll && (
            <Pressable
              onPress={onCollapseAll}
              style={({ pressed }) => [
                { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, opacity: pressed ? 0.7 : 1 },
                { backgroundColor: theme.colors.backgroundAlt },
              ]}
            >
              <Text
                style={[{ fontSize: theme.fontSize.sm, fontWeight: '500' as const }, { color: theme.colors.textMuted }]}
              >
                ▶ Collapse
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  ),
)
CollapsibleHeader.displayName = 'CollapsibleHeader'

const createStyles = createStyleSheet((theme) => ({
  container: {
    backgroundColor: 'transparent', // Will be overridden by theme
  },
  primitive: {
    fontSize: theme.fontSize.sm,
  },
  punctuation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  null: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.codeNull,
  },
  boolean: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.codeBoolean,
  },
  number: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.codeNumber,
  },
  string: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.codeString,
  },
  stringContainer: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
  },
  itemCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  arrayIndex: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  key: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600' as const,
    color: theme.colors.codeKey,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 1,
    paddingHorizontal: theme.spacing.lg,
  },
  toggleButton: {
    padding: theme.spacing.xxs,
  },
  toggleText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  actionsContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.xs,
  },
  actionButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xxs,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.backgroundAlt,
  },
  actionText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '500' as const,
    color: theme.colors.textMuted,
  },
  nestedContent: {
    paddingLeft: 0,
    marginLeft: 0,
  },
  nestedItem: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    paddingVertical: 1,
  },
}))
