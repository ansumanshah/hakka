import { parseControlCommand } from './control'
import type { MockRule, MockRuleInput } from './MockEngine'

export interface RuleBundle {
  version: 1
  rules: Array<MockRuleInput & { id: string }>
}

/** Validate the entire portable bundle before any runtime mutations occur. */
export function parseRuleBundle(value: unknown): RuleBundle {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('rules' in value) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 1000
  ) {
    throw new Error('Expected a version 1 rule bundle with at most 1000 rules')
  }
  const ids = new Set<string>()
  const rules = value.rules.map((rule: unknown, index: number) => {
    const command = parseControlCommand({ kind: 'mock.add', rule })
    if (!command || command.kind !== 'mock.add') throw new Error(`Invalid rule at index ${index}`)
    if (ids.has(command.rule.id)) throw new Error(`Duplicate rule ID at index ${index}`)
    ids.add(command.rule.id)
    return command.rule
  })
  return { version: 1, rules }
}

/** Export declarative rules without silently dropping executable behavior. */
export function createRuleBundle(rules: MockRule[]): RuleBundle {
  for (const [index, rule] of rules.entries()) {
    if (typeof rule.pattern !== 'string' || rule.response.bodyProvider || rule.rewriteRequest || rule.rewriteResponse) {
      throw new Error(`Rule at index ${index} contains executable behavior and cannot be exported`)
    }
  }
  return parseRuleBundle({
    version: 1,
    rules: rules.map((rule) => ({
      ...rule,
      response: { ...rule.response, body: rule.response.body ?? '' },
    })),
  })
}
