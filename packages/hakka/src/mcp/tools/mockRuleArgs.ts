import type { MockRuleInput } from 'hakka-core'

/**
 * Per-mode (`mock`/`redirect`/`block`, `modify`-implies-rewrite) mock-rule
 * construction shared by `create_mock` and `verify_fix`'s optional inline
 * mock step, so the two can't drift on the mode rules.
 */

export interface MockRuleArgs {
  pattern: string
  method?: string
  mode?: 'mock' | 'block' | 'redirect'
  status?: number
  body?: string
  redirectTo?: string
  delayMs?: number
  modify?: MockRuleInput['modify']
}

/**
 * Mirrors `packages/hakka-browser/src/ui/MockTab.tsx` `handleAdd`'s per-mode
 * shape exactly. A `modify` block implies passthrough-then-transform, so
 * `mode=mock` + `modify` becomes a rewrite rule — the canned response fields
 * would be ignored by the engine anyway.
 */
export function buildMockRuleFromArgs(id: string, args: MockRuleArgs): MockRuleInput & { id: string } {
  const { pattern, method, mode = 'mock', status = 200, body, redirectTo, delayMs, modify } = args

  if (mode === 'mock' && modify) {
    return {
      id,
      pattern,
      method,
      mode: 'rewrite',
      modify,
      response: { status: 200, body: '', delay: delayMs },
      enabled: true,
    }
  }
  if (mode === 'mock') {
    return {
      id,
      pattern,
      method,
      mode: 'mock',
      response: { status, body: body ?? '', delay: delayMs },
      enabled: true,
    }
  }
  if (mode === 'redirect') {
    return {
      id,
      pattern,
      method,
      mode: 'rewrite',
      redirectTo,
      modify,
      response: { status: 200, body: '', delay: delayMs },
      enabled: true,
    }
  }
  // block
  return {
    id,
    pattern,
    method,
    block: true,
    response: { status: 0, body: '', delay: delayMs },
    enabled: true,
  }
}
