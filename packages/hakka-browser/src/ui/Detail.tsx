import type { NetworkRequest } from 'hakka-core'
import {
  formatTimestamp,
  parseUrl,
  isImageResponse,
  getImageSource,
  decodeUrl,
  isUrlEncoded,
  bodyDecoders,
  parseRequestCookies,
  parseSetCookie,
} from 'hakka-core'
import { createSignal, createMemo, createEffect, For, Show, onSettled } from 'solid-js'
import type { Component } from 'solid-js'

import { store } from '../worker'
import { DetailActionBar } from './DetailActionBar'
import { DetailBodyRegion } from './DetailBodyRegion'
import { DetailCookiesTab } from './DetailCookiesTab'
import { DetailGraphQLTab } from './DetailGraphQLTab'
import { DetailOverviewTab } from './DetailOverviewTab'
import { DetailTimingTab } from './DetailTimingTab'
import { IconArrowDown, IconArrowLeft, IconArrowUp } from './icons'
import { consumeRowTapOrigin, RequestRow } from './RequestRow'
import { createRequestDetailViewModel, type RequestDetailViewModel } from './viewModels'

// Re-exported so existing imports of `BodySearch` from './Detail' keep working
// (it moved to its own file since it's a substantial, independently testable
// unit — the body viewer + inline search bar).
export { BodySearch } from './DetailBodySearch'

type Tab = 'overview' | 'request' | 'response' | 'timing' | 'cookies' | 'messages' | 'graphql'

// Case-insensitive header lookup.
const getHeader = (headers: Record<string, string> | undefined | null, name: string): string | undefined =>
  headers ? Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] : undefined

interface DetailProps {
  req: NetworkRequest
  onBack: () => void
  /**
   * Injected view-model (ADR 0003 (b)) — omit to default-construct one
   * against the shared store singleton, the exact behavior this component
   * always had. A future `<hakka-request-detail>` custom element passes its
   * own instance here instead.
   */
  viewModel?: RequestDetailViewModel
}

export const Detail: Component<DetailProps> = (props) => {
  const [tab, setTab] = createSignal<Tab>('overview')
  const [urlDecoded, setUrlDecoded] = createSignal(false)

  // ── Body hydration ──
  // props.req is the slim main-thread mirror (StoreConfig.slimEcho) — request/
  // response bodies are usually absent. RequestDetailViewModel fetches the real
  // bytes on selection and merges them into `full()`; read through `full()`
  // below, not `props.req`, for anything body-dependent. The effect re-fires
  // selectRequest on every props.req reference change so the view-model's own
  // staleness guard (blank on different id, keep-stale on same id) reruns
  // correctly across row-to-row selection in the split view.
  const vm = props.viewModel ?? createRequestDetailViewModel({ store: store() })
  const [vmSnap, setVmSnap] = createSignal(vm.getSnapshot())
  createEffect(
    () => props.req,
    (req) => {
      vm.intents.selectRequest(req)
    },
  )
  onSettled(() => {
    const vmUnsub = vm.subscribe(() => setVmSnap(vm.getSnapshot()))
    // onSettled runs later than 1.x onMount — selectRequest's synchronous
    // notify fires before this subscription exists, so re-pull or it's lost.
    setVmSnap(vm.getSnapshot())
    return () => {
      vmUnsub()
      if (!props.viewModel) vm.intents.clear()
    }
  })

  const full = createMemo<NetworkRequest>(() => vmSnap().request ?? props.req)

  // ── Body text region — 2.0 async memo (stale-content revalidation) ──
  // Separate async read of the same store().getBody() RPC RequestDetailViewModel
  // already calls internally (cheap in-memory/Worker-message lookup, not a real
  // re-fetch) — scoped only to the <Loading>-wrapped body text (DetailBodyRegion).
  // Solid's async-memo model then keeps the previous body visible until the new
  // one resolves, instead of flashing to "No request/response body" mid-fetch.
  // `full()` above is unaffected and keeps its own synchronous blank/keep-stale
  // contract for every other consumer (curl, mock, GraphQL, image preview).
  const bodyAsync = createMemo<{ requestBody: string | null; responseBody: string | null }>(async () => {
    const id = props.req.id
    const bodies = await store().getBody(id)
    return bodies ?? { requestBody: props.req.requestBody ?? null, responseBody: props.req.responseBody ?? null }
  })

  const isImg = () => isImageResponse(props.req.responseHeaders ?? {})
  const imgSrc = () => {
    if (!isImg()) return ''
    return getImageSource(props.req.url, full().responseBody ?? '', props.req.responseHeaders ?? {}) ?? ''
  }

  // Decoded bodies — run raw bodies through the shared decoder registry (gzip/
  // deflate/SSE/protobuf-wire/grpc-web); passthrough-safe for JSON/plain text.
  // Reads through `bodyAsync()`, not `full()` — only ever rendered inside the
  // <Loading>-wrapped body region, so inheriting bodyAsync()'s pending-ness is fine.
  const decodedRequestBody = createMemo(() => {
    const body = bodyAsync().requestBody
    if (!body) return body
    return bodyDecoders.decode(
      body,
      getHeader(props.req.requestHeaders, 'content-type'),
      getHeader(props.req.requestHeaders, 'content-encoding'),
    )
  })
  const decodedResponseBody = createMemo(() => {
    const body = bodyAsync().responseBody
    if (!body) return body
    return bodyDecoders.decode(
      body,
      getHeader(props.req.responseHeaders, 'content-type'),
      getHeader(props.req.responseHeaders, 'content-encoding'),
    )
  })

  const messages = () => props.req.messages ?? []
  const isWebSocket = () => props.req.source === 'websocket' || messages().length > 0

  const requestCookieHeader = createMemo(
    () => props.req.requestHeaders?.['Cookie'] ?? props.req.requestHeaders?.['cookie'],
  )
  const responseCookieHeader = createMemo(() => {
    const h = props.req.responseHeaders
    if (!h) return undefined
    // Set-Cookie may be stored as a single string (possibly newline-joined) or array
    return (h['Set-Cookie'] ?? h['set-cookie']) as string | string[] | undefined
  })
  const hasCookies = createMemo(() => {
    const reqC = parseRequestCookies(requestCookieHeader()).length > 0
    const resC = parseSetCookie(responseCookieHeader()).length > 0
    return reqC || resC
  })

  const displayPath = createMemo(() => {
    const url = props.req.url
    const raw = parseUrl(url).path || '/'
    if (urlDecoded()) return decodeUrl(raw)
    return raw
  })
  const urlHasEncoding = createMemo(() => isUrlEncoded(props.req.url))

  const TABS = createMemo<{ id: Tab; label: string }[]>(() => {
    const base: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'request', label: 'Request' },
      { id: 'response', label: 'Response' },
      { id: 'timing', label: 'Timing' },
    ]
    if (props.req.graphql) base.push({ id: 'graphql', label: 'GraphQL' })
    if (hasCookies()) base.push({ id: 'cookies', label: 'Cookies' })
    if (isWebSocket())
      base.push({ id: 'messages', label: `Frames${messages().length ? ` (${messages().length})` : ''}` })
    return base
  })

  // ── Accordion enter — the tapped row slides from its list position to the
  // header slot (FLIP). WAAPI, compositor-only properties; guarded for jsdom
  // / reduced-motion / the >=900px split where the list stays visible and an
  // expansion would lie about what happened.
  let rootEl: HTMLDivElement | undefined
  let rowbackEl: HTMLDivElement | undefined
  let tabsEl: HTMLDivElement | undefined

  // Keep the active tab visible when the strip overflows (up to 6 tabs on a
  // narrow phone) — a chevron-less overflow cue plus this guarantee is the
  // adopted Bruno pattern (fade mask on .hakka-tabs, styles.ts). Guarded for
  // jsdom/happy-dom, which may not implement scrollIntoView at all.
  createEffect(
    () => tab(),
    () => {
      if (!tabsEl) return
      const active = tabsEl.querySelector<HTMLElement>('.hakka-tab.active')
      if (!active || typeof active.scrollIntoView !== 'function') return
      const reduceMotion =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      active.scrollIntoView({ inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    },
  )
  // Effect, not onMount: the Detail pane can stay mounted while the selected
  // request changes, and each fresh row tap should replay the expansion.
  createEffect(
    () => props.req.id,
    () => {
      const originY = consumeRowTapOrigin()
      if (originY == null || !rootEl || !rowbackEl) return
      if (typeof rowbackEl.animate !== 'function' || typeof window.matchMedia !== 'function') return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      if (window.matchMedia('(min-width: 900px)').matches) return
      const delta = originY - rowbackEl.getBoundingClientRect().top
      const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
      if (Math.abs(delta) > 2) {
        rowbackEl.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
          duration: 220,
          easing: EASE,
        })
      }
      // Tabs, content, and the bottom bar fade-slide in just behind the row's
      // landing — reads as the row unfolding its detail.
      for (const el of Array.from(rootEl.children)) {
        if (el.tagName === 'STYLE' || el.contains(rowbackEl)) continue
        ;(el as HTMLElement).animate(
          [
            { opacity: 0, transform: 'translateY(-8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 180, delay: 120, easing: EASE, fill: 'both' },
        )
      }
    },
  )

  // Keyframes for timing-bar grow (scaleX) and tab cross-fade.
  // Injected inline so they live inside the Shadow DOM without touching styles.ts.
  const DETAIL_KEYFRAMES = `
    @keyframes hakka-bar-grow {
      from { transform: scaleX(0); opacity: 0; }
      to   { transform: scaleX(1); opacity: 1; }
    }
    @keyframes hakka-tab-fade {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes hakka-bar-grow  { from { opacity:0 } to { opacity:1 } }
      @keyframes hakka-tab-fade  { from { opacity:0 } to { opacity:1 } }
    }
  `

  return (
    <div class="hakka-detail" ref={(el) => (rootEl = el)}>
      <style>{DETAIL_KEYFRAMES}</style>
      {/* Detail header — the tapped row IS the page header: shared RequestRow
          renders it pixel-identical to the list, so opening a request reads
          as the row expanding in place. Tapping the row (or its focusable
          chevron) returns to the list — no dedicated Back button, and the
          toolbar below carries only actions. */}
      <div class="hakka-detail-header">
        <div class="hakka-detail-rowback" ref={(el) => (rowbackEl = el)}>
          <RequestRow req={props.req} selected={false} onSelect={props.onBack} />
        </div>
        <Show when={urlHasEncoding() && urlDecoded()}>
          <div class="hakka-detail-decoded">{displayPath()}</div>
        </Show>
      </div>

      {/* Tabs — secondary nav, deliberately smaller than the main tab strip
          (CSS scopes .hakka-detail .hakka-tab down). The ← back control leads
          the strip; tapping the header row above also goes back. */}
      <div
        class="hakka-tabs"
        style="overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap"
        ref={(el) => (tabsEl = el)}
      >
        <button
          class="hakka-back-btn hakka-detail-tabs-back"
          onClick={props.onBack}
          aria-label="Back to request list"
          title="Back to list"
        >
          <IconArrowLeft size={12} />
        </button>
        <For each={TABS()}>
          {(t) => (
            <button
              class={`hakka-tab${tab() === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style="white-space:nowrap"
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      <div class="hakka-tab-content" style="animation:hakka-tab-fade 150ms cubic-bezier(0.4,0,0.2,1)">
        <Show when={tab() === 'overview'}>
          <DetailOverviewTab req={props.req} />
        </Show>

        {/* Headers live with their own side — request headers above the
            request body, response headers above the response body — instead
            of a separate Headers tab doubling the strip's width. */}
        <Show when={tab() === 'request'}>
          <DetailBodyRegion
            headers={props.req.requestHeaders}
            headersTitle="Request Headers"
            noBodyLabel="No request body"
            body={decodedRequestBody}
            pendingSource={bodyAsync}
          />
        </Show>

        <Show when={tab() === 'response'}>
          <Show when={isImg()}>
            <img class="hakka-img-preview" src={imgSrc()} alt="Response image" />
          </Show>
          <Show when={!isImg()}>
            <DetailBodyRegion
              headers={props.req.responseHeaders}
              headersTitle="Response Headers"
              noBodyLabel="No response body"
              body={decodedResponseBody}
              pendingSource={bodyAsync}
            />
          </Show>
        </Show>

        <Show when={tab() === 'timing'}>
          <DetailTimingTab req={props.req} />
        </Show>

        <Show when={tab() === 'graphql'}>
          <Show
            when={props.req.graphql}
            fallback={
              <div class="hakka-list-empty">
                <span class="hakka-empty-title">No GraphQL metadata</span>
              </div>
            }
          >
            <DetailGraphQLTab req={full()} />
          </Show>
        </Show>

        <Show when={tab() === 'cookies'}>
          <DetailCookiesTab
            requestCookieHeader={requestCookieHeader()}
            responseCookieHeaders={responseCookieHeader()}
          />
        </Show>

        <Show when={tab() === 'messages'}>
          <Show
            when={messages().length > 0}
            fallback={
              <div class="hakka-list-empty">
                <span class="hakka-empty-title">No WebSocket frames captured</span>
              </div>
            }
          >
            <div class="hakka-ws-list">
              <For each={messages()}>
                {(msg) => (
                  <div class={`hakka-ws-msg hakka-ws-${msg.direction}`}>
                    <span class="hakka-ws-dir" title={msg.direction}>
                      {msg.direction === 'sent' ? <IconArrowUp size={9} /> : <IconArrowDown size={9} />}
                    </span>
                    <span class="hakka-ws-data">
                      {typeof msg.data === 'string' ? msg.data : `‹binary ${msg.data} bytes›`}
                    </span>
                    <span class="hakka-ws-time">{formatTimestamp(msg.timestamp)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
      <DetailActionBar
        req={props.req}
        full={full}
        urlHasEncoding={urlHasEncoding}
        urlDecoded={urlDecoded}
        onToggleUrlDecoded={() => setUrlDecoded((d) => !d)}
      />
    </div>
  )
}
