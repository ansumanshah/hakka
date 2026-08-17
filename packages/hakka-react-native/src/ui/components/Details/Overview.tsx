import type { NetworkRequest } from 'hakka-core'
import { formatBytes, formatDuration as formatDurationCore, formatTimestamp } from 'hakka-core'
import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { KeyValueList, SectionHeader, buildCurl, createSharedStyles } from './helpers'

interface OverviewProps {
  request: NetworkRequest
}

export const Overview: React.FC<OverviewProps> = ({ request }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const curlCommand = useMemo(() => buildCurl(request), [request])
  const fields = useMemo(() => buildOverviewFields(request), [request])

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <SectionHeader title="COMMAND" content={curlCommand} theme={theme} />
        <Text
          style={[
            createSharedStyles(theme).codeBlock,
            { backgroundColor: theme.colors.codeBackground, color: theme.colors.codeText },
          ]}
          selectable
        >
          {curlCommand}
        </Text>
      </View>
      <View style={styles.section}>
        <KeyValueList data={fields} theme={theme} />
      </View>
    </View>
  )
}

const createStyles = createStyleSheet(({ spacing }) => ({
  container: {
    flex: 1,
  },
  section: {
    marginBottom: spacing.xl,
  },
}))

/**
 * Overview field list — mirrors web's Detail.tsx overview table field-for-field
 * (packages/hakka-browser/src/ui/Detail.tsx). Each row is conditional on the field being
 * present, in the same order as web.
 */
function buildOverviewFields(request: NetworkRequest): [string, string][] {
  const fields: [string, string][] = [
    ['URL', request.url],
    ['Method', request.method.toUpperCase()],
    ['Status', request.status != null ? String(request.status) : request.error ? `Error: ${request.error}` : 'Pending'],
    ['Duration', request.duration != null ? formatDurationCore(request.duration) : '…'],
  ]

  if (request.requestBodySize != null && request.requestBodySize > 0) {
    fields.push(['Request size', formatBytes(request.requestBodySize)])
  }
  const responseSize = request.responseBodySize ?? request.size
  if (responseSize != null) {
    fields.push(['Response size', formatBytes(responseSize)])
  }
  if (request.contentType) {
    fields.push(['Content-Type', request.contentType])
  }
  if (request.encoding) {
    fields.push(['Encoding', request.encoding])
  }
  if (request.networkProtocol) {
    fields.push(['Protocol', request.networkProtocol])
  }
  fields.push(['Started', formatTimestamp(request.startTime)])
  if (request.source) {
    fields.push(['Source', request.source + (request.library ? ` · ${request.library}` : '')])
  }
  if (request.runtime) {
    fields.push(['Runtime', request.runtime])
  }
  if (request.redirectCount != null && request.redirectCount > 0) {
    fields.push([
      'Redirects',
      `${request.redirectCount}${request.redirectChain?.length ? ` · ${request.redirectChain.join(' → ')}` : ''}`,
    ])
  }
  if (request.retryCount != null && request.retryCount > 0) {
    fields.push(['Retries', String(request.retryCount)])
  }
  if (request.messages?.length) {
    fields.push([
      'WebSocket',
      `${request.messages.length} frames${request.wsProtocol ? ` · ${request.wsProtocol}` : ''}`,
    ])
  }
  if (request.correlationId) {
    fields.push(['Trace', request.correlationId])
  }
  if (request.graphql) {
    fields.push([
      'GraphQL',
      `${request.graphql.operationType}${request.graphql.operationName ? ` · ${request.graphql.operationName}` : ''}`,
    ])
  }
  if (request.mocked) {
    fields.push(['Mocked', 'Yes'])
  }
  if (request.rewritten) {
    fields.push(['Rewritten', 'Yes'])
  }
  // The store id — lets you cross-reference this exact request in hakka mcp
  // (get_request) or a bug report.
  fields.push(['Request ID', request.id])

  return fields
}
