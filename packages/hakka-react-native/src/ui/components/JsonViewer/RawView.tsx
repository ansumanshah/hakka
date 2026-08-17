import React, { memo } from 'react'
import { Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'

type JsonViewerTheme = ReturnType<typeof useTheme>

/**
 * Raw JSON view with syntax highlighting
 */

interface RawViewProps {
  jsonString: string
  searchQuery: string
  theme?: JsonViewerTheme
  currentMatchIndex?: number
  onLayoutMatch?: (matchIndex: number, y: number) => void
}

const LINE_HEIGHT = 18
const STRING_REGEX = /"([^"\\]*(\\.[^"\\]*)*)"/g
const NUMBER_SEGMENT_REGEX = /(-?\d+\.?\d*)/
const BOOLEAN_SEGMENT_REGEX = /(true|false)/
const NULL_SEGMENT_REGEX = /(null)/

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`)

interface RawLineProps {
  line: string
  lineIndex: number
  lineOffset: number
  searchQuery: string
  theme: JsonViewerTheme
  currentMatchIndex: number
  onLayoutMatch?: (matchIndex: number, y: number) => void
  matchCountRef: React.MutableRefObject<number>
  lineStyle: {
    fontSize: number
    fontFamily: string
    lineHeight: number
    color: string
  }
}

const buildHighlightedParts = (
  text: string,
  baseColor: string,
  query: string,
  searchHighlightColor: string,
  matchCountRef: React.MutableRefObject<number>,
  lineIndex: number,
  lineOffset: number,
  baseKey: string,
  currentMatchIndex: number,
  onLayoutMatch?: (matchIndex: number, y: number) => void,
): React.ReactNode[] => {
  const trimmedQuery = query.trim().toLowerCase()
  if (!trimmedQuery) {
    return [<Text key={`${baseKey}:${lineOffset}:${baseColor}`}>{text}</Text>]
  }

  const queryRegex = new RegExp(escapeRegExp(trimmedQuery), 'g')
  const loweredText = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0

  let match: RegExpExecArray | null
  while ((match = queryRegex.exec(loweredText)) !== null) {
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length

    if (matchStart > cursor) {
      parts.push(
        <Text key={`${baseKey}:plain:${lineOffset}:${cursor}`} style={{ color: baseColor }}>
          {text.substring(cursor, matchStart)}
        </Text>,
      )
    }

    const matchText = text.substring(matchStart, matchEnd)
    const thisMatchIndex = matchCountRef.current
    const isActiveMatch = thisMatchIndex === currentMatchIndex

    parts.push(
      <Text
        key={`${baseKey}:match:${lineOffset}:${matchStart}-${matchEnd}`}
        style={{
          backgroundColor: isActiveMatch ? '#ffd43b' : searchHighlightColor,
          color: '#212529',
          fontWeight: isActiveMatch ? '900' : '700',
        }}
        onLayout={(e) => {
          if (isActiveMatch && onLayoutMatch) {
            onLayoutMatch(thisMatchIndex, e.nativeEvent.layout.y + lineIndex * LINE_HEIGHT)
          }
        }}
      >
        {matchText}
      </Text>,
    )

    matchCountRef.current += 1
    cursor = matchEnd
  }

  if (cursor < text.length) {
    parts.push(
      <Text key={`${baseKey}:plain:${lineOffset}:${cursor}:tail`} style={{ color: baseColor }}>
        {text.substring(cursor)}
      </Text>,
    )
  }

  return parts
}

const addBeforeTextSegments = (
  beforeText: string,
  beforeStartOffset: number,
  lineOffset: number,
  searchQuery: string,
  matchCountRef: React.MutableRefObject<number>,
  lineIndex: number,
  currentMatchIndex: number,
  onLayoutMatch: ((matchIndex: number, y: number) => void) | undefined,
  theme: JsonViewerTheme,
): React.ReactNode[] => {
  const parts: React.ReactNode[] = []
  const numberMatch = beforeText.match(NUMBER_SEGMENT_REGEX)
  const boolMatch = beforeText.match(BOOLEAN_SEGMENT_REGEX)
  const nullMatch = beforeText.match(NULL_SEGMENT_REGEX)

  if (numberMatch) {
    const numberOffset = beforeStartOffset + numberMatch.index!
    const segments = beforeText.split(numberMatch[0])
    if (segments[0]) {
      parts.push(
        ...buildHighlightedParts(
          segments[0],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:prefix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    parts.push(
      <Text key={`number:${lineOffset}:${numberOffset}`} style={{ color: theme.colors.codeNumber }}>
        {numberMatch[0]}
      </Text>,
    )
    if (segments[1]) {
      parts.push(
        ...buildHighlightedParts(
          segments[1],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:suffix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    return parts
  }

  if (boolMatch) {
    const boolOffset = beforeStartOffset + boolMatch.index!
    const segments = beforeText.split(boolMatch[0])
    if (segments[0]) {
      parts.push(
        ...buildHighlightedParts(
          segments[0],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:prefix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    parts.push(
      <Text key={`bool:${lineOffset}:${boolOffset}`} style={{ color: theme.colors.codeBoolean }}>
        {boolMatch[0]}
      </Text>,
    )
    if (segments[1]) {
      parts.push(
        ...buildHighlightedParts(
          segments[1],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:suffix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    return parts
  }

  if (nullMatch) {
    const nullOffset = beforeStartOffset + nullMatch.index!
    const segments = beforeText.split(nullMatch[0])
    if (segments[0]) {
      parts.push(
        ...buildHighlightedParts(
          segments[0],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:prefix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    parts.push(
      <Text key={`null:${lineOffset}:${nullOffset}`} style={{ color: theme.colors.codeNull }}>
        {nullMatch[0]}
      </Text>,
    )
    if (segments[1]) {
      parts.push(
        ...buildHighlightedParts(
          segments[1],
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `before:${beforeStartOffset}:suffix`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }
    return parts
  }

  parts.push(
    <Text key={`remaining:${lineOffset}:${beforeStartOffset}`} style={{ color: theme.colors.codePunctuation }}>
      {beforeText}
    </Text>,
  )
  return parts
}

const RawLine = memo<RawLineProps>(
  ({ line, lineIndex, lineOffset, searchQuery, theme, currentMatchIndex, onLayoutMatch, matchCountRef, lineStyle }) => {
    const segments: React.ReactNode[] = []
    let currentIndex = 0

    const matches: Array<{ start: number; end: number; type: 'key' | 'string' }> = []
    let stringMatch: RegExpExecArray | null

    STRING_REGEX.lastIndex = 0
    while ((stringMatch = STRING_REGEX.exec(line)) !== null) {
      const isKey = line[stringMatch.index + stringMatch[0].length] === ':'
      matches.push({
        start: stringMatch.index,
        end: stringMatch.index + stringMatch[0].length,
        type: isKey ? 'key' : 'string',
      })
    }

    matches.forEach((matchedSegment) => {
      if (matchedSegment.start > currentIndex) {
        segments.push(
          ...addBeforeTextSegments(
            line.substring(currentIndex, matchedSegment.start),
            lineOffset + currentIndex,
            lineOffset,
            searchQuery,
            matchCountRef,
            lineIndex,
            currentMatchIndex,
            onLayoutMatch,
            theme,
          ),
        )
      }

      const matchedText = line.substring(matchedSegment.start, matchedSegment.end)
      const baseColor = matchedSegment.type === 'key' ? theme.colors.codeKey : theme.colors.codeString
      segments.push(
        ...buildHighlightedParts(
          matchedText,
          baseColor,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `match:${lineOffset}:${matchedSegment.start}-${matchedSegment.end}`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
      currentIndex = matchedSegment.end
    })

    if (currentIndex < line.length) {
      segments.push(
        ...buildHighlightedParts(
          line.substring(currentIndex),
          theme.colors.codePunctuation,
          searchQuery,
          theme.colors.codeHighlight,
          matchCountRef,
          lineIndex,
          lineOffset,
          `remaining:${lineOffset}:${currentIndex}`,
          currentMatchIndex,
          onLayoutMatch,
        ),
      )
    }

    return (
      <Text selectable style={lineStyle}>
        {segments}
      </Text>
    )
  },
)

RawLine.displayName = 'RawLine'

const mapLinesWithOffsets = (jsonString: string) => {
  const lines = jsonString.split('\n')
  let offset = 0

  return lines.map((line, lineIndex) => {
    const record = { line, lineIndex, offset }
    offset += line.length + 1
    return record
  })
}

export const RawView = memo<RawViewProps>(
  ({ jsonString, searchQuery, theme: customTheme, currentMatchIndex = 0, onLayoutMatch }) => {
    const matchCountRef = React.useRef(0)
    const fallbackTheme = useTheme()
    const theme = customTheme || fallbackTheme
    const { colors } = theme
    const styles = createStyleSheet(() => ({
      container: {
        backgroundColor: colors.background,
      },
      line: {
        fontSize: theme.fontSize.sm,
        fontFamily: 'monospace',
        lineHeight: 18,
        color: colors.text,
      },
    }))(theme)

    matchCountRef.current = 0
    const lines = mapLinesWithOffsets(jsonString)

    return (
      <View style={styles.container}>
        {lines.map((lineData) => (
          <RawLine
            key={`line:${lineData.offset}:${lineData.line.length}`}
            line={lineData.line}
            lineIndex={lineData.lineIndex}
            lineOffset={lineData.offset}
            lineStyle={styles.line}
            searchQuery={searchQuery}
            theme={theme}
            currentMatchIndex={currentMatchIndex}
            onLayoutMatch={onLayoutMatch}
            matchCountRef={matchCountRef}
          />
        ))}
      </View>
    )
  },
)

RawView.displayName = 'RawView'
