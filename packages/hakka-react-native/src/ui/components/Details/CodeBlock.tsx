import React from 'react'
import { View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { JsonViewer } from '../JsonViewer'

/**
 * CodeBlock - Just the black code area
 * ViewMode controlled by parent via SectionHeader
 */

interface CodeBlockProps {
  data: string
  searchQuery?: string
  currentMatchIndex?: number
  onMatchCountChange?: (current: number, total: number) => void
  viewMode?: 'tree' | 'raw'
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  data,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  viewMode = 'raw',
}) => {
  const theme = useTheme()
  const styles = createStyles(theme)

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.codeBackground }]}>
      <JsonViewer
        data={data}
        searchQuery={searchQuery}
        currentMatchIndex={currentMatchIndex}
        onMatchCountChange={onMatchCountChange}
        viewMode={viewMode}
        hideToggle={true}
      />
    </View>
  )
}

const createStyles = createStyleSheet(() => ({
  container: {
    overflow: 'hidden',
  },
}))
