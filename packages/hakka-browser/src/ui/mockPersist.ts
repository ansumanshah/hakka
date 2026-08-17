/**
 * mockPersist — localStorage persistence for MockEngine rules.
 *
 * Key: `hakka:mocks` (follows the `hakka:` prefix convention in persist.ts).
 * Only serializes rules with string patterns and no function fields.
 */

import { mockEngine } from 'hakka-core'
import type { MockRule } from 'hakka-core'

const KEY = 'hakka:mocks'

interface PersistedMockRule {
  pattern: string
  method?: string
  mode?: 'mock' | 'rewrite'
  redirectTo?: string
  block?: boolean
  status: number
  body: string
  enabled: boolean
}

function isBrowser(): boolean {
  return typeof localStorage !== 'undefined'
}

function isSerializable(rule: MockRule): rule is MockRule & { pattern: string } {
  // Only persist rules that have a plain string pattern and no function-only fields
  return (
    typeof rule.pattern === 'string' &&
    rule.response.bodyProvider == null &&
    rule.rewriteRequest == null &&
    rule.rewriteResponse == null
  )
}

function serializeRules(rules: MockRule[]): PersistedMockRule[] {
  return rules.filter(isSerializable).map((rule) => ({
    pattern: rule.pattern,
    method: rule.method,
    mode: rule.mode,
    redirectTo: rule.redirectTo,
    block: rule.block,
    status: rule.response.status,
    body: typeof rule.response.body === 'string' ? rule.response.body : '',
    enabled: rule.enabled,
  }))
}

export function saveMocks(): void {
  if (!isBrowser()) return
  try {
    const data = serializeRules(mockEngine.getRules())
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // no-op: private mode or quota exceeded
  }
}

export function loadMocks(): void {
  if (!isBrowser()) return
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const items = JSON.parse(raw) as unknown[]
    if (!Array.isArray(items)) return

    const existing = mockEngine.getRules()

    for (const item of items) {
      if (
        item == null ||
        typeof item !== 'object' ||
        !('pattern' in item) ||
        typeof (item as Record<string, unknown>)['pattern'] !== 'string'
      ) {
        continue
      }

      const p = item as Partial<PersistedMockRule>
      const pattern = p.pattern as string
      const method = typeof p.method === 'string' ? p.method : undefined

      // Skip if a rule with the same pattern+method is already loaded
      const dupe = existing.some((r) => r.pattern === pattern && (r.method ?? undefined) === (method ?? undefined))
      if (dupe) continue

      mockEngine.addRule({
        pattern,
        method,
        mode: p.mode === 'rewrite' ? 'rewrite' : 'mock',
        redirectTo: typeof p.redirectTo === 'string' ? p.redirectTo : undefined,
        block: p.block === true ? true : undefined,
        response: {
          status: typeof p.status === 'number' ? p.status : 200,
          body: typeof p.body === 'string' ? p.body : '',
        },
        enabled: p.enabled !== false,
      })
    }
  } catch {
    // corrupted storage — silently ignore
  }
}

export function exportMocksJson(): string {
  return JSON.stringify(serializeRules(mockEngine.getRules()), null, 2)
}

export function importMocksJson(json: string): number {
  let items: unknown[]
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return 0
    items = parsed
  } catch {
    return 0
  }

  const existing = mockEngine.getRules()
  let added = 0

  for (const item of items) {
    if (
      item == null ||
      typeof item !== 'object' ||
      !('pattern' in item) ||
      typeof (item as Record<string, unknown>)['pattern'] !== 'string'
    ) {
      continue
    }

    const p = item as Partial<PersistedMockRule>
    const pattern = p.pattern as string
    const method = typeof p.method === 'string' ? p.method : undefined

    // Skip dupes by pattern+method
    const dupe = existing.some((r) => r.pattern === pattern && (r.method ?? undefined) === (method ?? undefined))
    if (dupe) continue

    mockEngine.addRule({
      pattern,
      method,
      mode: p.mode === 'rewrite' ? 'rewrite' : 'mock',
      redirectTo: typeof p.redirectTo === 'string' ? p.redirectTo : undefined,
      block: p.block === true ? true : undefined,
      response: {
        status: typeof p.status === 'number' ? p.status : 200,
        body: typeof p.body === 'string' ? p.body : '',
      },
      enabled: p.enabled !== false,
    })
    added++
  }

  return added
}
