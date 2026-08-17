import type { NetworkRequest } from 'hakka-core'
import { extractGraphQLQuery } from 'hakka-core'
import type { Component } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'

import { JsonViewer } from './LazyJsonViewer'

interface DetailGraphQLTabProps {
  req: NetworkRequest
}

export const DetailGraphQLTab: Component<DetailGraphQLTabProps> = (props) => {
  const gql = () => props.req.graphql!
  const hasVariables = () => {
    const v = gql().variables
    return v != null && Object.keys(v).length > 0
  }
  // Parsed UI-side from the request body — not part of GraphQLInfo/the wire contract.
  // null when the body is missing/truncated/not-JSON or has no `query` field (e.g. a
  // persisted-query request); rendered as nothing rather than an empty block below.
  const queryText = createMemo(() => extractGraphQLQuery(props.req.requestBody))

  const gqlErrors = createMemo((): { message: string; path?: string[] }[] => {
    const body = props.req.responseBody
    if (!body) return []
    try {
      const parsed = JSON.parse(body) as unknown
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'errors' in parsed &&
        Array.isArray((parsed as { errors: unknown }).errors)
      ) {
        const arr = (parsed as { errors: { message?: unknown; path?: unknown }[] }).errors
        return arr.map((e) => ({
          message: typeof e.message === 'string' ? e.message : JSON.stringify(e.message ?? ''),
          path: Array.isArray(e.path) ? (e.path as unknown[]).map(String) : undefined,
        }))
      }
    } catch {}
    return []
  })

  return (
    <div>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: 'var(--hakka-space-sm)',
          'margin-bottom': 'var(--hakka-space-md)',
          'flex-wrap': 'wrap',
        }}
      >
        <span
          style={{
            'font-size': 'var(--hakka-font-xs)',
            'font-weight': '600',
            'letter-spacing': '0.04em',
            'text-transform': 'uppercase',
            color: 'var(--hakka-text-tertiary)',
          }}
        >
          {gql().operationType}
        </span>
        <Show when={gql().operationName}>
          <span
            style={{
              'font-size': 'var(--hakka-font-sm)',
              'font-weight': '600',
              color: 'var(--hakka-text)',
              'font-family': 'var(--hakka-font-mono)',
            }}
          >
            {gql().operationName}
          </span>
        </Show>
        <Show when={!gql().operationName}>
          <span
            style={{
              'font-size': 'var(--hakka-font-sm)',
              color: 'var(--hakka-text-secondary)',
              'font-style': 'italic',
            }}
          >
            (anonymous)
          </span>
        </Show>
      </div>

      <Show when={queryText()}>
        <p class="hakka-section-title">Query</p>
        <JsonViewer text={queryText()} />
      </Show>

      <Show when={hasVariables()}>
        <p class="hakka-section-title">Variables</p>
        <JsonViewer text={JSON.stringify(gql().variables)} />
      </Show>
      <Show when={!hasVariables()}>
        <p class="hakka-empty-hint" style="margin-bottom:var(--hakka-space-md)">
          No variables
        </p>
      </Show>

      <Show when={gqlErrors().length > 0}>
        <p class="hakka-section-title" style="color:var(--hakka-status-error)">
          GraphQL Errors ({gqlErrors().length})
        </p>
        <div
          style={{
            'border-radius': 'var(--hakka-radius-md)',
            border: '1px solid var(--hakka-status-error)',
            overflow: 'hidden',
          }}
        >
          <For each={gqlErrors()}>
            {(err, i) => (
              <div
                style={{
                  padding: 'var(--hakka-space-sm) var(--hakka-space-md)',
                  'border-top':
                    i() > 0
                      ? '1px solid color-mix(in srgb, var(--hakka-status-error) var(--hakka-tint-border), transparent)'
                      : 'none',
                  background: 'color-mix(in srgb, var(--hakka-status-error) var(--hakka-tint-hover), transparent)',
                }}
              >
                <div
                  style={{
                    'font-size': 'var(--hakka-font-sm)',
                    color: 'var(--hakka-status-error)',
                    'font-weight': '600',
                    'margin-bottom': err.path ? 'var(--hakka-space-xs)' : undefined,
                  }}
                >
                  {err.message}
                </div>
                <Show when={err.path && err.path.length > 0}>
                  <div
                    style={{
                      'font-size': 'var(--hakka-font-xs)',
                      color: 'var(--hakka-text-tertiary)',
                      'font-family': 'var(--hakka-font-mono)',
                    }}
                  >
                    Path: {err.path!.join(' › ')}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
