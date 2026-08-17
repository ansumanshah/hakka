import React from 'react'
import { Text } from 'react-native'

import { useTheme } from '../styles'

interface SearchHighlighterProps {
  text: string
  query: string
  highlightColor?: string
  backgroundColor?: string
}

export const SearchHighlighter: React.FC<SearchHighlighterProps> = ({
  text,
  query,
  highlightColor,
  backgroundColor,
}) => {
  const theme = useTheme()

  if (!query.trim()) {
    return <Text>{text}</Text>
  }

  const parts = getHighlightedParts(text, query)
  const highlightBg = backgroundColor || theme.colors.codeHighlight
  const highlightTextColor = highlightColor || theme.colors.text

  return (
    <Text>
      {parts.map((part) =>
        part.isMatch ? (
          <Text
            key={`match:${part.start}:${part.value}`}
            style={{
              fontWeight: 'bold' as const,
              backgroundColor: highlightBg,
              color: highlightTextColor,
            }}
          >
            {part.value}
          </Text>
        ) : (
          <Text key={`text:${part.start}:${part.value}`}>{part.value}</Text>
        ),
      )}
    </Text>
  )
}

function getHighlightedParts(text: string, query: string): Array<{ value: string; start: number; isMatch: boolean }> {
  const escapedQuery = escapeRegExp(query)
  const regex = new RegExp(`(${escapedQuery})`, 'gi')
  const parts = text.split(regex)
  let cursor = 0
  return parts.map((value) => {
    const start = cursor
    cursor += value.length
    return { value, start, isMatch: value.toLowerCase() === query.toLowerCase() }
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`)
}
