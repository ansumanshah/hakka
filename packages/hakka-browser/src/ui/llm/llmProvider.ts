/**
 * LLM provider detection — host-based only, by design. Traffic rows are slim
 * (no bodies), so the row badge can rely on nothing but the URL; anything
 * body-dependent (model, usage) belongs to the detail pane's presenters.
 * The table stays data-driven and small: exact hosts, plus Azure's
 * resource-host suffix (`<resource>.openai.azure.com`).
 */
import { extractHost } from 'hakka-core'

export type LlmProviderId = 'openai' | 'azure-openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'mistral'

export interface LlmProvider {
  id: LlmProviderId
  /** Short badge label. */
  label: string
}

interface LlmProviderRule {
  id: LlmProviderId
  label: string
  /** Matched as an exact host. */
  hosts: string[]
  /** Matched as a host suffix (resource-style subdomains). */
  hostSuffixes?: string[]
}

const PROVIDER_RULES: LlmProviderRule[] = [
  { id: 'openai', label: 'OpenAI', hosts: ['api.openai.com'] },
  { id: 'azure-openai', label: 'Azure', hosts: [], hostSuffixes: ['.openai.azure.com'] },
  { id: 'anthropic', label: 'Anthropic', hosts: ['api.anthropic.com'] },
  { id: 'gemini', label: 'Gemini', hosts: ['generativelanguage.googleapis.com'] },
  { id: 'openrouter', label: 'OpenRouter', hosts: ['openrouter.ai'] },
  { id: 'groq', label: 'Groq', hosts: ['api.groq.com'] },
  { id: 'mistral', label: 'Mistral', hosts: ['api.mistral.ai'] },
]

/** The provider behind `url`, or `null` when the host matches no known rule. */
export function detectLlmProvider(url: string): LlmProvider | null {
  const host = extractHost(url).toLowerCase()
  if (host === 'unknown') return null

  for (const rule of PROVIDER_RULES) {
    if (rule.hosts.includes(host) || rule.hostSuffixes?.some((suffix) => host.endsWith(suffix))) {
      return { id: rule.id, label: rule.label }
    }
  }
  return null
}
