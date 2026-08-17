import React, { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { Toggle } from '../Toggle'
import { RawView } from './RawView'
import { TreeView } from './TreeView'
import { escapeRegex, formatJsonString, parseJson } from './utils'

export interface JsonViewerProps {
  data: unknown
  searchQuery?: string
  onMatchCountChange?: (current: number, total: number) => void
  currentMatchIndex?: number
  theme?: ReturnType<typeof useTheme>
  viewMode?: 'tree' | 'raw'
  hideToggle?: boolean
}

interface ScrollViewHandle {
  scrollTo: (options: { y: number; animated: boolean }) => void
}

// Module-scope factory so the WeakMap cache in createStyleSheet hits on every render
const createViewerStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  scrollView: {
    padding: theme.spacing.lg,
  },
  error: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
    padding: theme.spacing.lg,
    color: theme.colors.textMuted,
  },
}))

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  searchQuery = '',
  onMatchCountChange,
  currentMatchIndex = 0,
  theme: customTheme,
  viewMode: externalViewMode,
  hideToggle = false,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ root: true })
  const [internalViewMode, setInternalViewMode] = useState<'tree' | 'raw'>('raw')
  const scrollViewRef = React.useRef<ScrollViewHandle | null>(null)

  const viewMode = externalViewMode || internalViewMode
  const setViewMode = externalViewMode ? () => {} : setInternalViewMode

  const fallbackTheme = useTheme()
  const theme = customTheme || fallbackTheme
  const { colors } = theme
  const styles = createViewerStyles(theme)

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }, [])

  const collapseAll = useCallback(() => {
    setCollapsed({})
  }, [])

  const expandAll = useCallback(() => {
    const allPaths: Record<string, boolean> = {}
    const collectPaths = (obj: unknown, path: string) => {
      if (obj && typeof obj === 'object') {
        allPaths[path] = false // false = expanded
        Object.keys(obj).forEach((key) => {
          collectPaths((obj as Record<string, unknown>)[key], `${path}.${key}`)
        })
      }
    }
    try {
      const parsed = parseJson(data)
      collectPaths(parsed, 'root')
      setCollapsed(allPaths)
    } catch {
      // Invalid JSON
    }
  }, [data])

  useEffect(() => {
    setCollapsed({ root: true })
  }, [data])

  // Count matches and notify parent (debounced)
  useEffect(() => {
    if (!searchQuery.trim() || !onMatchCountChange) {
      onMatchCountChange?.(0, 0)
      return
    }

    const timer = setTimeout(() => {
      try {
        const jsonString = formatJsonString(data)
        const query = searchQuery.toLowerCase().trim()
        const regex = new RegExp(escapeRegex(query), 'gi')
        const matches = jsonString.match(regex)
        const totalMatches = matches ? matches.length : 0
        onMatchCountChange(1, totalMatches)
      } catch {
        onMatchCountChange(0, 0)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [searchQuery, data, onMatchCountChange])

  // Auto-expand paths that contain search matches (tree mode only)
  useEffect(() => {
    if (!searchQuery.trim() || viewMode !== 'tree') return

    const expandedPaths: Record<string, boolean> = {}
    const findMatches = (obj: unknown, path: string) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((key) => {
          const value = (obj as Record<string, unknown>)[key]
          const keyMatches = key.toLowerCase().includes(searchQuery.toLowerCase())
          const valueMatches = typeof value === 'string' && value.toLowerCase().includes(searchQuery.toLowerCase())

          if (keyMatches || valueMatches) {
            const parts = path.split('.')
            for (let i = 1; i <= parts.length; i++) {
              expandedPaths[parts.slice(0, i).join('.')] = false
            }
          }
          findMatches(value, `${path}.${key}`)
        })
      }
    }

    try {
      const parsed = parseJson(data)
      findMatches(parsed, 'root')
      setCollapsed(expandedPaths)
    } catch {
      // Invalid JSON
    }
  }, [searchQuery, data, viewMode])

  const handleMatchLayout = useCallback(
    (matchIndex: number, y: number) => {
      if (matchIndex === currentMatchIndex && scrollViewRef.current) {
        scrollViewRef.current.scrollTo({ y: Math.max(0, y - 100), animated: true })
      }
    },
    [currentMatchIndex],
  )

  try {
    const parsed = parseJson(data)
    const jsonString = formatJsonString(data)

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {!hideToggle && (
          <View style={styles.header}>
            <Toggle
              options={[
                { value: 'tree', label: 'Tree' },
                { value: 'raw', label: 'Raw' },
              ]}
              value={viewMode}
              onValueChange={(v: string) => setViewMode(v as 'tree' | 'raw')}
              theme={theme}
            />
          </View>
        )}

        <ScrollView
          ref={(node) => {
            scrollViewRef.current = node
          }}
          style={styles.scrollView}
        >
          {viewMode === 'tree' ? (
            <TreeView
              data={parsed}
              searchQuery={searchQuery}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              theme={theme}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
            />
          ) : (
            <RawView
              jsonString={jsonString}
              searchQuery={searchQuery}
              theme={theme}
              currentMatchIndex={currentMatchIndex}
              onLayoutMatch={handleMatchLayout}
            />
          )}
        </ScrollView>
      </View>
    )
  } catch {
    return (
      <View style={styles.container}>
        <Text style={styles.error} selectable>
          {String(data)}
        </Text>
      </View>
    )
  }
}
