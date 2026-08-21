import { lazy, Loading } from 'solid-js'
import type { Component } from 'solid-js'

/**
 * Code-split wrapper for the LLM usage section — the provider table stays
 * tiny and eager (the row badge needs it), but usage parsing rides in its
 * own chunk the first time an LLM response's Overview tab renders, keeping
 * the size gates green. Nothing shows until it arrives: usage rows are an
 * additive detail, not content the user is mid-read on.
 */
const LlmUsageSectionInner = lazy(() => import('./LlmUsageSection').then((m) => ({ default: m.LlmUsageSection })))

interface LlmUsageSectionProps {
  url: string
  /** Raw response-body accessor backed by the store's getBody round-trip (see Detail.tsx's bodyAsync). */
  body: () => string | null | undefined
}

export const LazyLlmUsageSection: Component<LlmUsageSectionProps> = (props) => (
  <Loading fallback={null}>
    <LlmUsageSectionInner url={props.url} body={props.body} />
  </Loading>
)
