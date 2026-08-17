/**
 * CookieSection — parse and display cookies from request/response headers.
 *
 * Request: reads `Cookie` header (single header, semicolon-separated pairs)
 * Response: reads `Set-Cookie` header (single header OR comma-joined multi-value)
 *
 * Both render as structured name/value rows with a count badge.
 */

import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { parseCookies } from '../../utils/cookieParsers'
import { KeyValueList, createSharedStyles } from './helpers'

interface CookieSectionProps {
  headers: Record<string, string> | null | undefined
  type: 'request' | 'response'
}

export const CookieSection: React.FC<CookieSectionProps> = ({ headers, type }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const sharedStyles = createSharedStyles(theme)
  const { colors } = theme

  const cookies = useMemo(() => parseCookies(headers, type), [headers, type])

  if (cookies.length === 0) return null

  const title = type === 'request' ? 'COOKIES' : 'SET-COOKIE'

  const listData: [string, string][] = cookies.map((c) =>
    c.attributes ? [c.name, `${c.value}  (${c.attributes})`] : [c.name, c.value],
  )

  return (
    <View style={sharedStyles.section}>
      <View style={[sharedStyles.sectionHeader, styles.headerRow]}>
        <Text style={sharedStyles.sectionTitle}>{title}</Text>
        <View style={[styles.countBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.countText, { color: colors.background }]}>{cookies.length}</Text>
        </View>
      </View>
      <KeyValueList data={listData} theme={theme} />
    </View>
  )
}

const createStyles = createStyleSheet(({ spacing, radius, fontSize, fontWeight }) => ({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    fontFamily: 'monospace',
  },
}))
