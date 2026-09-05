import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerSetThrottleTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'set_throttle',
    {
      description:
        'Simulate network conditions in the connected app. The command is applied inside connected app(s); ' +
        'application is acknowledged over the bridge. Affects DEV builds only.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        profile: z
          .enum(['none', 'fast-3g', 'slow-3g', 'edge', 'offline', 'custom'])
          .describe('Throttle preset. Use "custom" with latencyMs/downloadKbps for explicit values.'),
        latencyMs: z.number().min(0).optional().describe('Added latency in milliseconds (custom profile only)'),
        downloadKbps: z
          .number()
          .min(0)
          .optional()
          .describe('Simulated download bandwidth in kbps (custom profile only)'),
      },
    },
    async (args) => {
      const sent = await dispatchAcknowledged(sender, args.targetId, {
        kind: 'throttle.set',
        profile: args.profile,
        latencyMs: args.latencyMs,
        downloadKbps: args.downloadKbps,
      })
      if (!sent) {
        return textResult({ sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ sent: true })
    },
  )
}
