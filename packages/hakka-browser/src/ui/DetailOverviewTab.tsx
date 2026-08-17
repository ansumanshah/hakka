import type { NetworkRequest } from 'hakka-core'
import { formatBytes, formatDuration, formatTimestamp } from 'hakka-core'
import type { Component } from 'solid-js'
import { Show } from 'solid-js'

import { KVRow } from './DetailShared'
import { JsonViewer } from './LazyJsonViewer'

interface DetailOverviewTabProps {
  req: NetworkRequest
}

export const DetailOverviewTab: Component<DetailOverviewTabProps> = (props) => (
  <>
    <table class="hakka-kv-table">
      <tbody>
        <KVRow k="URL" v={props.req.url} />
        <KVRow k="Method" v={props.req.method.toUpperCase()} />
        {/* Status always shows as plain text here (even 200 alongside
            an error) — severity styling is error-first elsewhere (row
            stripe/pill color), but the status value itself is never
            displaced; same rule across platforms. Error gets its own
            row below instead of folding in, so it's never silently
            swallowed. */}
        <KVRow
          k="Status"
          v={props.req.status != null ? String(props.req.status) : props.req.error ? 'ERR' : 'Pending'}
        />
        <Show when={props.req.error}>
          <KVRow k="Error" v={props.req.error!} />
        </Show>
        <KVRow k="Duration" v={props.req.duration != null ? formatDuration(props.req.duration) : '…'} />
        <Show when={props.req.requestBodySize != null && props.req.requestBodySize > 0}>
          <KVRow k="Request size" v={formatBytes(props.req.requestBodySize!)} />
        </Show>
        <Show when={props.req.responseBodySize != null || props.req.size != null}>
          <KVRow k="Response size" v={formatBytes((props.req.responseBodySize ?? props.req.size)!)} />
        </Show>
        <Show when={props.req.contentType}>
          <KVRow k="Content-Type" v={props.req.contentType!} />
        </Show>
        <Show when={props.req.encoding}>
          <KVRow k="Encoding" v={props.req.encoding!} />
        </Show>
        <Show when={props.req.networkProtocol}>
          <KVRow k="Protocol" v={props.req.networkProtocol!} />
        </Show>
        <Show when={props.req.cacheStatus}>
          <KVRow k="Cache" v={props.req.cacheStatus!} />
        </Show>
        <KVRow k="Started" v={formatTimestamp(props.req.startTime)} />
        <Show when={props.req.source}>
          <KVRow k="Source" v={props.req.source! + (props.req.library ? ` · ${props.req.library}` : '')} />
        </Show>
        <Show when={props.req.runtime}>
          <KVRow k="Runtime" v={props.req.runtime!} />
        </Show>
        <Show when={props.req.redirectCount != null && props.req.redirectCount > 0}>
          <KVRow
            k="Redirects"
            v={`${props.req.redirectCount}${
              props.req.redirectChain?.length ? ` · ${props.req.redirectChain.join(' → ')}` : ''
            }`}
          />
        </Show>
        <Show when={props.req.retryCount != null && props.req.retryCount > 0}>
          <KVRow k="Retries" v={String(props.req.retryCount)} />
        </Show>
        <Show when={props.req.messages?.length}>
          <KVRow
            k="WebSocket"
            v={`${props.req.messages!.length} frames${props.req.wsProtocol ? ` · ${props.req.wsProtocol}` : ''}`}
          />
        </Show>
        <Show when={props.req.correlationId}>
          <KVRow k="Trace" v={props.req.correlationId!} />
        </Show>
        <Show when={props.req.graphql}>
          <KVRow
            k="GraphQL"
            v={`${props.req.graphql!.operationType}${
              props.req.graphql!.operationName ? ` · ${props.req.graphql!.operationName}` : ''
            }`}
          />
        </Show>
        <Show when={props.req.mocked}>
          <KVRow k="Mocked" v="Yes" />
        </Show>
        <Show when={props.req.rewritten}>
          <KVRow k="Rewritten" v="Yes" />
        </Show>
        {/* The store id — lets you cross-reference this exact request in
            hakka mcp (get_request) or a bug report. */}
        <KVRow k="Request ID" v={props.req.id} />
      </tbody>
    </table>
    <Show when={props.req.graphql?.variables && Object.keys(props.req.graphql.variables).length > 0}>
      <p class="hakka-section-title">GraphQL Variables</p>
      <JsonViewer text={JSON.stringify(props.req.graphql!.variables)} />
    </Show>
    <Show when={props.req.initiator}>
      <p class="hakka-section-title">Initiator</p>
      <pre class="hakka-initiator">{props.req.initiator}</pre>
    </Show>
  </>
)
