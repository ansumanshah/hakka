import { describe, expect, it } from 'vitest'

import { detectLlmProvider } from '../llmProvider'

describe('detectLlmProvider — host table', () => {
  it('detects each known provider by host, whatever the path', () => {
    const cases: Array<[url: string, id: string, label: string]> = [
      ['https://api.openai.com/v1/chat/completions', 'openai', 'OpenAI'],
      ['https://api.anthropic.com/v1/messages', 'anthropic', 'Anthropic'],
      [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent',
        'gemini',
        'Gemini',
      ],
      ['https://openrouter.ai/api/v1/chat/completions', 'openrouter', 'OpenRouter'],
      ['https://api.groq.com/openai/v1/chat/completions', 'groq', 'Groq'],
      ['https://api.mistral.ai/v1/chat/completions', 'mistral', 'Mistral'],
    ]
    for (const [url, id, label] of cases) {
      expect(detectLlmProvider(url), url).toEqual({ id, label })
    }
  })

  it('matches Azure by resource-host suffix across deployment paths', () => {
    expect(
      detectLlmProvider(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21',
      ),
    ).toEqual({ id: 'azure-openai', label: 'Azure' })
  })

  it('returns null for hosts outside the table — even OpenAI-shaped paths', () => {
    expect(detectLlmProvider('https://api.example.com/v1/chat/completions')).toBeNull()
    expect(detectLlmProvider('http://localhost:11434/v1/chat/completions')).toBeNull()
    expect(detectLlmProvider('https://myapp.dev/api/chat')).toBeNull()
  })

  it('tolerates ports and mixed case', () => {
    expect(detectLlmProvider('https://API.OPENAI.COM:443/v1/responses')).toEqual({ id: 'openai', label: 'OpenAI' })
  })
})
