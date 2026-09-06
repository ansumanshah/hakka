import { createRuleBundle, mockEngine, parseRuleBundle } from 'hakka-core'

const KEY = 'hakka:mocks'

function decodeRules(json: string) {
  const value: unknown = JSON.parse(json)
  // Migrate the original browser-only flat format into the shared wire contract.
  if (Array.isArray(value)) {
    return parseRuleBundle({
      version: 1,
      rules: value.map((item: Record<string, unknown>, index) => ({
        id: `imported_${index}`,
        pattern: item.pattern,
        method: item.method,
        mode: item.mode ?? 'mock',
        redirectTo: item.redirectTo,
        block: item.block,
        enabled: item.enabled !== false,
        response: { status: item.status ?? 200, body: item.body ?? '' },
      })),
    })
  }
  return parseRuleBundle(value)
}

export function saveMocks(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, exportMocksJson())
  } catch {
    // Private mode, quota, or an executable rule can prevent persistence.
  }
}

export function loadMocks(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) importMocksJson(raw)
  } catch {
    // Corrupted storage does not affect capture.
  }
}

export function exportMocksJson(): string {
  return JSON.stringify(createRuleBundle(mockEngine.getRules()), null, 2)
}

/** Merge only new rules; validate the whole file before changing the engine. */
export function importMocksJson(json: string): number {
  const bundle = decodeRules(json)
  let added = 0
  for (const rule of bundle.rules) {
    const existing = mockEngine.getRules()
    if (
      existing.some(
        (current) => current.id === rule.id || (current.pattern === rule.pattern && current.method === rule.method),
      )
    )
      continue
    mockEngine.addRule(rule)
    added++
  }
  return added
}
