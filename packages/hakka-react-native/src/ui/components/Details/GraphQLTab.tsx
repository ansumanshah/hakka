import type { NetworkRequest } from 'hakka-core'
import { extractGraphQLQuery } from 'hakka-core'
import React, { useMemo } from 'react'
import { Text, View } from 'react-native'

import { createStyleSheet, useTheme } from '../../styles'
import { CodeBlock } from './CodeBlock'
import { createSharedStyles, KeyValueList, SectionHeader } from './helpers'

interface GraphQLTabProps {
  request: NetworkRequest
}

interface GraphQLError {
  message?: string
  path?: (string | number)[]
}

/** Pull the `errors` array out of a GraphQL response body (if any). */
function parseGraphQLErrors(responseBody?: string | null): GraphQLError[] {
  if (!responseBody) return []
  try {
    const parsed = JSON.parse(responseBody) as { errors?: GraphQLError[] }
    return Array.isArray(parsed?.errors) ? parsed.errors : []
  } catch {
    return []
  }
}

/**
 * GraphQL detail tab — splits a captured GraphQL operation into operation, variables, and
 * errors. The operation metadata is detected in core (`extractGraphQLInfo`) and stamped on
 * `request.graphql`; errors are parsed from the response body here.
 */
export const GraphQLTab: React.FC<GraphQLTabProps> = ({ request }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const shared = createSharedStyles(theme)
  const gql = request.graphql

  const errors = useMemo(() => parseGraphQLErrors(request.responseBody), [request.responseBody])
  const variablesJson = useMemo(() => (gql?.variables ? JSON.stringify(gql.variables, null, 2) : ''), [gql?.variables])
  // Parsed UI-side from the request body — not part of GraphQLInfo/the wire contract.
  // null when the body is missing/truncated/not-JSON or has no `query` field (e.g. a
  // persisted-query request); rendered as nothing rather than an empty section below.
  const queryText = useMemo(() => extractGraphQLQuery(request.requestBody), [request.requestBody])

  if (!gql) {
    return (
      <View style={styles.container}>
        <Text style={shared.nullText} selectable>
          Not a GraphQL operation
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={shared.section}>
        <SectionHeader title="OPERATION" theme={theme} />
        <KeyValueList data={{ Type: gql.operationType, Name: gql.operationName ?? '(anonymous)' }} theme={theme} />
      </View>

      {queryText ? (
        <View style={shared.section}>
          <SectionHeader title="QUERY" content={queryText} theme={theme} />
          <CodeBlock data={queryText} viewMode="tree" />
        </View>
      ) : null}

      {variablesJson ? (
        <View style={shared.section}>
          <SectionHeader title="VARIABLES" content={variablesJson} theme={theme} />
          <CodeBlock data={variablesJson} viewMode="tree" />
        </View>
      ) : null}

      <View style={shared.section}>
        <SectionHeader title={errors.length ? `ERRORS (${errors.length})` : 'ERRORS'} theme={theme} />
        {errors.length ? (
          errors.map((e, i) => (
            <View key={`${i}-${e.message ?? ''}`} style={shared.headerRow}>
              <Text style={[shared.headerValue, { color: theme.colors.error }]} selectable>
                {e.message ?? JSON.stringify(e)}
                {e.path?.length ? `  @ ${e.path.join('.')}` : ''}
              </Text>
            </View>
          ))
        ) : (
          <Text style={shared.nullText} selectable>
            No errors
          </Text>
        )}
      </View>
    </View>
  )
}

const createStyles = createStyleSheet(() => ({
  container: {
    flex: 1,
  },
}))
