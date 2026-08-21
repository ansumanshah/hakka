/**
 * LLM usage presenter — pulls token accounting and the model name out of a
 * captured response body, whatever shape it arrived in: a plain JSON
 * response, or an event stream whose FINAL events carry the totals (the wire
 * shape every major provider uses for streaming). Tokens only — no cost
 * math, no price table: a wrong number is worse than none, and pricing is a
 * moving target.
 */
import { decodeSse } from 'hakka-core'

import type { LlmProviderId } from './llmProvider'

export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  model?: string
}

/** Which wire shape a provider uses for `usage` — several providers share the OpenAI one. */
type UsageFamily = 'openai' | 'anthropic' | 'gemini'

const FAMILY_BY_PROVIDER: Record<LlmProviderId, UsageFamily> = {
  openai: 'openai',
  'azure-openai': 'openai',
  openrouter: 'openai',
  groq: 'openai',
  mistral: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
}

/** Field names per family — the ONLY thing that differs between the three wire shapes. */
interface UsageFieldNames {
  /** Key holding the token counts, on the response or on the streaming fact-carrier. */
  counts: string
  prompt: string
  completion: string
  total?: string
  /** Key holding the model name, on the response (Anthropic: on `message`). */
  model: string
}

const FAMILY_FIELDS: Record<UsageFamily, UsageFieldNames> = {
  openai: {
    counts: 'usage',
    prompt: 'prompt_tokens',
    completion: 'completion_tokens',
    total: 'total_tokens',
    model: 'model',
  },
  anthropic: { counts: 'usage', prompt: 'input_tokens', completion: 'output_tokens', model: 'model' },
  gemini: {
    counts: 'usageMetadata',
    prompt: 'promptTokenCount',
    completion: 'candidatesTokenCount',
    total: 'totalTokenCount',
    model: 'modelVersion',
  },
}

const ALL_FAMILIES: UsageFamily[] = ['openai', 'anthropic', 'gemini']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one family's usage off `value` (a response object, an OpenAI chunk, an Anthropic message). */
function readUsage(family: UsageFamily, value: Record<string, unknown>): LlmUsage {
  const fields = FAMILY_FIELDS[family]
  const usage: LlmUsage = {}
  const model = readString(value, fields.model)
  if (model !== undefined) usage.model = model
  const raw = value[fields.counts]
  if (isRecord(raw)) {
    const prompt = readNumber(raw, fields.prompt)
    const completion = readNumber(raw, fields.completion)
    const total = fields.total !== undefined ? readNumber(raw, fields.total) : undefined
    if (prompt !== undefined) usage.promptTokens = prompt
    if (completion !== undefined) usage.completionTokens = completion
    if (total !== undefined) usage.totalTokens = total
  }
  return usage
}

/** Streaming events refine as they arrive (counts grow, output tokens finalize), so token fields use last-wins; the model is announced once, up front. */
function mergeUsage(into: LlmUsage, from: LlmUsage): void {
  for (const field of ['promptTokens', 'completionTokens', 'totalTokens'] as const) {
    if (from[field] !== undefined) into[field] = from[field]
  }
  if (into.model === undefined && from.model !== undefined) into.model = from.model
}

/** Fill `totalTokens` from the two halves when the wire omits it — arithmetic, not pricing. */
function withDerivedTotal(usage: LlmUsage): LlmUsage {
  if (usage.totalTokens === undefined && usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    return { ...usage, totalTokens: usage.promptTokens + usage.completionTokens }
  }
  return usage
}

/** `true` for event-stream bodies — a `data:`/`event:` line start, which no provider's plain JSON response has. */
function looksLikeEventStream(text: string): boolean {
  return /^[ \t]*(?:data|event):/m.test(text)
}

function isEmptyUsage(usage: LlmUsage): boolean {
  return usage.promptTokens === undefined && usage.completionTokens === undefined && usage.totalTokens === undefined
}

/** Fold an event stream's usage facts under one family's field names. */
function readEventStreamUsage(text: string, family: UsageFamily): LlmUsage | null {
  const merged: LlmUsage = {}

  for (const event of decodeSse(text)) {
    let payload: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(event.data)
      if (isRecord(parsed)) payload = parsed
    } catch {
      continue
    }
    if (!payload) continue

    if (family === 'anthropic') {
      // Anthropic splits its facts: message_start owns the model + input
      // tokens, message_delta finalizes output tokens.
      if (payload.type === 'message_start' && isRecord(payload.message)) {
        mergeUsage(merged, readUsage(family, payload.message))
      } else if (payload.type === 'message_delta') {
        mergeUsage(merged, readUsage(family, payload))
      }
      continue
    }

    mergeUsage(merged, readUsage(family, payload))
  }

  return isEmptyUsage(merged) && merged.model === undefined ? null : merged
}

/**
 * Parse token usage + model out of a response body. `provider` picks the
 * matching wire shape first; without it (or on a mismatch) every shape is
 * tried, so OpenAI-compatible endpoints behind unknown hosts still parse.
 * Returns `null` when the body carries no usage and no model at all.
 */
export function parseLlmUsage(text: string | null | undefined, provider?: LlmProviderId): LlmUsage | null {
  if (!text) return null
  const families = provider ? orderedFamilies(FAMILY_BY_PROVIDER[provider]) : ALL_FAMILIES

  if (looksLikeEventStream(text)) {
    let best: LlmUsage | null = null
    for (const family of families) {
      const usage = readEventStreamUsage(text, family)
      if (usage && !isEmptyUsage(usage)) {
        best = usage
        break
      }
      if (usage && best === null) best = usage // model-only, before any tokens arrive
    }
    if (best === null || (isEmptyUsage(best) && best.model === undefined)) return null
    return withDerivedTotal(best)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  for (const family of families) {
    const usage = readUsage(family, parsed)
    if (!isEmptyUsage(usage)) return withDerivedTotal(usage)
  }
  return null
}

function orderedFamilies(preferred: UsageFamily): UsageFamily[] {
  const order: UsageFamily[] = [preferred]
  for (const family of ALL_FAMILIES) {
    if (family !== preferred) order.push(family)
  }
  return order
}
