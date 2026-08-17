import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerSetThrottleTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'set_throttle',
    {
      description:
        'Simulate network conditions in the connected app. The command is applied inside connected app(s); ' +
        'delivery is fire-and-forget over the bridge (no acknowledgment). Affects DEV builds only.',
      inputSchema: {
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
    (args) => {
      const sent = dispatch(sender, {
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
