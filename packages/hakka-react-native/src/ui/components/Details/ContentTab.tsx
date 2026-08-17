import type { NetworkRequest } from 'hakka-core'
import { bodyDecoders, decodeUrl, getImageSource, isImageResponse, isUrlEncoded } from 'hakka-core'
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { ImagePreview } from '../ImagePreview'
import { CodeBlock } from './CodeBlock'
import { CookieSection } from './CookieSection'
import { createSharedStyles, KeyValueList, SectionHeader } from './helpers'

interface ContentTabProps {
  request: NetworkRequest
  searchQuery: string
  type: 'request' | 'response'
  currentMatchIndex?: number
  onMatchCountChange?: (current: number, total: number) => void
}

// Case-insensitive header lookup (headers are a plain Record<string, string>).
const getHeader = (headers: Record<string, string> | undefined | null, name: string): string | undefined =>
  headers ? Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] : undefined

// Parse the raw (still URL-encoded) query string. We avoid URL.searchParams here so the
// "Raw" view can show the on-the-wire encoding; the "Decoded" view applies core decodeUrl.
const getRawQueryParams = (url: string): [string, string][] => {
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return []
  const query = url.slice(qIndex + 1).split('#')[0]
  if (!query) return []
  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    return eq === -1 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]
  })
}

export const ContentTab: React.FC<ContentTabProps> = ({
  request,
  searchQuery,
  type,
  currentMatchIndex,
  onMatchCountChange,
}) => {
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('raw')
  const [urlDecoded, setUrlDecoded] = useState(true)
  const theme = useTheme()
  const styles = createStyles(theme)
  const sharedStyles = createSharedStyles(theme)

  const isRequest = type === 'request'
  const headers = isRequest ? request.requestHeaders : request.responseHeaders
  const body = isRequest ? request.requestBody : request.responseBody
  const contentType = getHeader(headers, 'content-type')
  const contentEncoding = getHeader(headers, 'content-encoding')
  const decodedBody = body ? bodyDecoders.decode(body, contentType, contentEncoding) : body
  const hasBody = decodedBody && typeof decodedBody === 'string' && decodedBody.trim() !== ''

  const filteredBody =
    searchQuery.trim() && decodedBody
      ? decodedBody.toLowerCase().includes(searchQuery.toLowerCase())
        ? decodedBody
        : ''
      : decodedBody

  const isImage = !isRequest && isImageResponse(headers)
  const imageSource = isImage ? getImageSource(request.url, body ?? undefined, headers ?? undefined) : null

  // Query params: raw (on-the-wire, encoded) vs decoded view. Toggle shown only when encoded.
  const rawParams = isRequest ? getRawQueryParams(request.url) : []
  const hasEncodedParam = rawParams.some(([k, v]) => isUrlEncoded(k) || isUrlEncoded(v))
  const queryParams: [string, string][] = urlDecoded
    ? rawParams.map(([k, v]) => [decodeUrl(k), decodeUrl(v)])
    : rawParams

  return (
    <View style={styles.container}>
      {isRequest && (
        <View style={sharedStyles.section}>
          <SectionHeader
            title="QUERY PARAMETERS"
            content={request.url.includes('?') ? request.url.split('?')[1] : undefined}
            theme={theme}
          />
          {hasEncodedParam && (
            <View style={[sharedStyles.headerRow, { justifyContent: 'flex-end' }]}>
              <View style={sharedStyles.toggleGroup}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setUrlDecoded(true)}
                  style={[sharedStyles.toggleBtn, urlDecoded && sharedStyles.toggleBtnActive]}
                >
                  <Text style={[sharedStyles.toggleText, urlDecoded && sharedStyles.toggleTextActive]}>Decoded</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setUrlDecoded(false)}
                  style={[sharedStyles.toggleBtn, !urlDecoded && sharedStyles.toggleBtnActive]}
                >
                  <Text style={[sharedStyles.toggleText, !urlDecoded && sharedStyles.toggleTextActive]}>Raw</Text>
                </Pressable>
              </View>
            </View>
          )}
          <KeyValueList data={queryParams} searchQuery={searchQuery} theme={theme} />
        </View>
      )}

      <View style={createSharedStyles(theme).section}>
        <SectionHeader title="HEADERS" content={headers ? JSON.stringify(headers, null, 2) : undefined} theme={theme} />
        <KeyValueList data={headers || {}} searchQuery={searchQuery} theme={theme} />
      </View>

      <CookieSection headers={headers} type={type} />

      <View style={createSharedStyles(theme).section}>
        <SectionHeader
          title="BODY"
          content={decodedBody ?? undefined}
          viewMode={hasBody && filteredBody && !isImage ? viewMode : undefined}
          onViewModeChange={hasBody && filteredBody && !isImage ? setViewMode : undefined}
          theme={theme}
        />
        {isImage && imageSource ? (
          <ImagePreview uri={imageSource} alt={request.url} />
        ) : hasBody && filteredBody ? (
          <CodeBlock
            data={filteredBody}
            searchQuery={searchQuery}
            currentMatchIndex={currentMatchIndex}
            onMatchCountChange={onMatchCountChange}
            viewMode={viewMode}
          />
        ) : (
          <Text style={createSharedStyles(theme).nullText} selectable>
            null
          </Text>
        )}
      </View>
    </View>
  )
}

const createStyles = createStyleSheet(() => ({
  container: {},
}))
