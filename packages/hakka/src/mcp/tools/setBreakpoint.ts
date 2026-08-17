import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerSetBreakpointTool(server: McpServer, sender: ControlSender): void {
  let breakpointIdCounter = 0

  server.registerTool(
    'set_breakpoint',
    {
      description:
        'Pause matching requests or responses in the connected app for manual inspection/editing. The command ' +
        'is applied inside connected app(s); delivery is fire-and-forget over the bridge (no acknowledgment). ' +
        'Affects DEV builds only.',
      inputSchema: {
        pattern: z.string().min(1).describe('Substring to match against the request URL'),
        on: z
          .enum(['request', 'response'])
          .describe('Pause before the request is sent, or before the response is delivered'),
      },
    },
    (args) => {
      breakpointIdCounter++
      const id = `mcp-bp-${breakpointIdCounter}`
      const sent = dispatch(sender, {
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
