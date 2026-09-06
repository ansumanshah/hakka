import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { parseRuleBundle } from 'hakka-core'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerApplyRuleBundleTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'apply_rule_bundle',
    {
      description:
        'Validate and install a portable version 1 Hakka rule bundle in a selected runtime. ' +
        'Stable IDs replace matching rules, making retries safe. Validates every rule before sending; ' +
        'reports applied IDs if the connection fails partway through. Does not clear unrelated rules.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        targetId: z.string().optional().describe('Target from list_targets; required with multiple runtimes.'),
        bundle: z.object({ version: z.literal(1), rules: z.array(z.unknown()).max(1000) }),
        dryRun: z.boolean().default(false).describe('Validate and return rule IDs without changing any runtime.'),
      },
    },
    async ({ bundle, targetId, dryRun }) => {
      let parsed
      try {
        parsed = parseRuleBundle(bundle)
      } catch (error) {
        return textResult(
          { error: 'invalid_bundle', message: error instanceof Error ? error.message : 'Invalid bundle' },
          true,
        )
      }
      if (dryRun) return textResult({ valid: true, applied: [], ruleIds: parsed.rules.map((rule) => rule.id) })
      const applied: string[] = []
      for (const rule of parsed.rules) {
        try {
          if (!(await dispatchAcknowledged(sender, targetId, { kind: 'mock.add', rule }))) {
            return textResult({ error: 'bridge_disconnected', applied, failedId: rule.id }, true)
          }
          applied.push(rule.id)
        } catch {
          return textResult(
            {
              error: 'application_failed',
              applied,
              failedId: rule.id,
              message: 'Check list_targets and retry the same bundle; already applied IDs are replaced.',
            },
            true,
          )
        }
      }
      return textResult({ applied, count: applied.length })
    },
  )
}
