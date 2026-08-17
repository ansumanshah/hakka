// Bottom action bar — Copy as / Copy / Replay / Mock / Agent pinned to the
// sheet bottom, thumb reach on a phone; Detail's content scrolls behind it.
// Dropdowns inside open UPWARD (CSS).
import {
  Hakka,
  buildCurl,
  buildAxios,
  buildHttpie,
  buildPython,
  buildMswHandlers,
  toPlaywrightRoutes,
  generateMockRules,
  mockEngine,
  replayRequest,
} from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import type { Component } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'

import { copyToClipboard } from '../adapters/clipboard'
import { shareText } from '../adapters/share'
import { buildFetch, buildRequestText } from '../requestFormat'
import { store } from '../worker'
import { copyAgentContextForRequest } from './agentEvidenceAction'
import { IconCheck, IconRefresh, IconSparkle } from './icons'
import { saveMocks } from './mockPersist'

type Action =
  | 'curl'
  | 'fetch'
  | 'axios'
  | 'httpie'
  | 'python'
  | 'msw'
  | 'playwright'
  | 'text'
  | 'share'
  | 'replay'
  | 'mock'
  | 'agentContext'

const CODE_ACTIONS: ReadonlySet<Action> = new Set(['curl', 'fetch', 'axios', 'httpie', 'python', 'msw', 'playwright'])

interface DetailActionBarProps {
  /** Raw slim request — used only for the share title and the WebSocket check. */
  req: NetworkRequest
  /** Hydrated request (body-complete) — every copy/replay/mock action reads through this. */
  full: () => NetworkRequest
  urlHasEncoding: () => boolean
  urlDecoded: () => boolean
  onToggleUrlDecoded: () => void
}

export const DetailActionBar: Component<DetailActionBarProps> = (props) => {
  const [copied, setCopied] = createSignal<Action | null>(null)

  const flashCopied = (which: Action) => {
    setCopied(which)
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500)
  }

  const copiedAsCode = () => copied() !== null && CODE_ACTIONS.has(copied()!)

  const copyCurl = () => {
    void copyToClipboard(buildCurl(props.full())).then((ok) => ok && flashCopied('curl'))
  }
  const copyFetch = () => {
    void copyToClipboard(buildFetch(props.full())).then((ok) => ok && flashCopied('fetch'))
  }
  const copyAxios = () => {
    void copyToClipboard(buildAxios(props.full())).then((ok) => ok && flashCopied('axios'))
  }
  const copyHttpie = () => {
    void copyToClipboard(buildHttpie(props.full())).then((ok) => ok && flashCopied('httpie'))
  }
  const copyPython = () => {
    void copyToClipboard(buildPython(props.full())).then((ok) => ok && flashCopied('python'))
  }
  const copyMsw = () => {
    void copyToClipboard(buildMswHandlers([props.full()])).then((ok) => ok && flashCopied('msw'))
  }
  const copyPlaywright = () => {
    void copyToClipboard(toPlaywrightRoutes([props.full()])).then((ok) => ok && flashCopied('playwright'))
  }
  const copyText = () => {
    void copyToClipboard(buildRequestText(props.full())).then((ok) => ok && flashCopied('text'))
  }
  const share = () => {
    void shareText({ title: `${props.req.method} ${props.req.url}`, text: buildRequestText(props.full()) }).then(
      (ok) => {
        if (ok) flashCopied('share')
      },
    )
  }

  // Evidence-bundle handoff for AI coding agents — assembled main-thread; see
  // agentEvidenceAction.ts's docblock for why this can't be a StoreClient/
  // storeEngine method.
  const copyAgentContext = () => {
    void copyAgentContextForRequest(store(), props.full()).then((ok) => ok && flashCopied('agentContext'))
  }

  // One-click "record then mock": turn this captured request into an enabled
  // mock rule (same path the Mock tab and hakka mcp's generate_mocks use).
  const canMock = () => props.full().status != null || props.full().responseBody != null
  const mockThis = () => {
    const rules = generateMockRules([props.full()], { idPrefix: 'ui-mock' })
    if (rules.length === 0) return
    for (const r of rules) mockEngine.addRule(r)
    saveMocks()
    flashCopied('mock')
  }

  // `replayRequest` (hakka-core) is the same extracted primitive the
  // `request.replay` control command dispatches — one definition of "how to
  // replay a captured request", not two.
  const canReplay = () => props.req.source !== 'websocket'
  const replay = () => {
    flashCopied('replay')
    void replayRequest(props.full())
  }

  // Context-menu actions contributed by plugins (Hakka.use). Each runs against
  // the selected request. Empty (and zero-cost) when no plugins are registered.
  const contextItems = createMemo(() => Hakka.getContextMenuItems())

  return (
    <div
      class="hakka-detail-status"
      style="display:flex;flex-wrap:wrap;gap:var(--hakka-space-xs);align-items:center;overflow-x:auto;-webkit-overflow-scrolling:touch"
    >
      <Show when={props.urlHasEncoding()}>
        {/* Solid 2.0 RC's dom-expressions drops `aria-*` attrs entirely on a
            `false` value instead of serializing "false" (verified against a
            minimal repro) — stringify explicitly so the attribute is always
            present, as ARIA requires. */}
        <button
          class={`hakka-curl-btn${props.urlDecoded() ? ' active' : ''}`}
          onClick={props.onToggleUrlDecoded}
          aria-pressed={props.urlDecoded() ? 'true' : 'false'}
          title={props.urlDecoded() ? 'Hide the decoded URL' : 'Show the percent-decoded URL under the row'}
        >
          Decode URL
        </button>
      </Show>
      <details class="hakka-menu">
        <summary class="hakka-curl-btn" title="Copy this request as code">
          <Show when={copiedAsCode()} fallback="Copy as">
            <IconCheck size={11} /> Copied
          </Show>
        </summary>
        <div class="hakka-menu-list">
          <button class="hakka-btn" onClick={copyCurl} title="Copy as cURL">
            cURL
          </button>
          <button class="hakka-btn" onClick={copyFetch} title="Copy as fetch()">
            fetch
          </button>
          <button class="hakka-btn" onClick={copyAxios} title="Copy as axios">
            axios
          </button>
          <button class="hakka-btn" onClick={copyHttpie} title="Copy as HTTPie">
            HTTPie
          </button>
          <button class="hakka-btn" onClick={copyPython} title="Copy as Python (requests)">
            Python
          </button>
          <button class="hakka-btn" onClick={copyMsw} title="Copy as MSW handler">
            MSW handler
          </button>
          <button class="hakka-btn" onClick={copyPlaywright} title="Copy as Playwright route">
            Playwright route
          </button>
          <button class="hakka-btn" onClick={share} title="Share request">
            {copied() === 'share' ? <IconCheck size={11} /> : 'Share'}
          </button>
        </div>
      </details>
      <button class="hakka-curl-btn" onClick={copyText} title="Copy as text">
        {copied() === 'text' ? <IconCheck size={11} /> : 'Copy'}
      </button>
      <Show when={canReplay()}>
        <button class="hakka-curl-btn" onClick={replay} title="Re-send this request">
          <IconRefresh size={11} /> {copied() === 'replay' ? 'Sent' : 'Replay'}
        </button>
      </Show>
      <Show when={canMock()}>
        <button
          class="hakka-curl-btn"
          onClick={mockThis}
          title="Create an enabled mock rule from this captured response (manage it in the Mock tab)"
        >
          {copied() === 'mock' ? <IconCheck size={11} /> : 'Mock this'}
        </button>
      </Show>
      <button
        class="hakka-curl-btn"
        onClick={copyAgentContext}
        title="Copy a size-budgeted evidence bundle (requests, spans, console, diagnosis) for pasting into an AI coding agent"
        aria-label="Copy as agent context"
      >
        {copied() === 'agentContext' ? (
          <IconCheck size={11} />
        ) : (
          <>
            <IconSparkle size={11} /> Agent
          </>
        )}
      </button>
      <For each={contextItems()}>
        {(item) => (
          <button class="hakka-curl-btn" title={item.label} onClick={() => item.run(props.full())}>
            {item.label}
          </button>
        )}
      </For>
    </div>
  )
}
