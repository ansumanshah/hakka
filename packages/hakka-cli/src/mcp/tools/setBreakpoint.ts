import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerSetBreakpointTool(server: McpServer, sender: ControlSender): void {
  let breakpointIdCounter = 0

  server.registerTool(
    'set_breakpoint',
    {
      description:
        'Pause matching requests or responses in the connected app for manual inspection/editing. The command ' +
        'is applied inside selected runtime; application is acknowledged over the bridge. ' +
        'Affects DEV builds only.',
      inputSchema: {
        targetId: z
          .string()
          .optional()
          .describe('Runtime target ID from list_targets; required when multiple peers are connected.'),
        pattern: z.string().min(1).describe('Substring to match against the request URL'),
        on: z
          .enum(['request', 'response'])
          .describe('Pause before the request is sent, or before the response is delivered'),
      },
    },
    async (args) => {
      breakpointIdCounter++
      const id = `mcp-bp-${breakpointIdCounter}`
      const sent = await dispatchAcknowledged(sender, args.targetId, {
        kind: 'breakpoint.add',
        breakpoint: { id, pattern: args.pattern, on: args.on, enabled: true },
      })
      if (!sent) {
        return textResult({ id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id, sent: true })
    },
  )
}
