/**
 * Usage section for LLM responses — provider-detected by URL, tokens + model
 * parsed from the response body through Detail's body-loading path (the slim
 * row mirror never carries bodies). Rendered from the Overview tab; loads as
 * its own lazy chunk via `LazyLlmUsageSection`. Tokens only — no cost math.
 */
import type { Component } from 'solid-js'
import { createMemo, Loading, Show } from 'solid-js'

import { KVRow } from './DetailShared'
import { detectLlmProvider } from './llm/llmProvider'
import { parseLlmUsage } from './llm/llmUsage'

interface LlmUsageSectionProps {
  url: string
  /** Raw response-body accessor backed by the store's getBody round-trip (see Detail.tsx's bodyAsync). */
  body: () => string | null | undefined
}

export const LlmUsageSection: Component<LlmUsageSectionProps> = (props) => {
  const provider = createMemo(() => detectLlmProvider(props.url))
  // Null until the body hydrates, or when the body carries no usage and no
  // model — a mid-stream capture legitimately has neither yet. Read through
  // the same async body memo Detail's body region uses; the <Loading> below
  // scopes its pending-ness to this section.
  const usage = createMemo(() => parseLlmUsage(props.body(), provider()?.id))

  return (
    <Show when={provider()}>
      <Loading fallback={null}>
        <Show when={usage()}>
          <p class="hakka-section-title">Usage · {provider()!.label}</p>
          <table class="hakka-kv-table">
            <tbody>
              <Show when={usage()!.model}>
                <KVRow k="Model" v={usage()!.model!} />
              </Show>
              <Show when={usage()!.promptTokens != null}>
                <KVRow k="Prompt tokens" v={String(usage()!.promptTokens)} />
              </Show>
              <Show when={usage()!.completionTokens != null}>
                <KVRow k="Completion tokens" v={String(usage()!.completionTokens)} />
              </Show>
              <Show when={usage()!.totalTokens != null}>
                <KVRow k="Total tokens" v={String(usage()!.totalTokens)} />
              </Show>
            </tbody>
          </table>
        </Show>
      </Loading>
    </Show>
  )
}
