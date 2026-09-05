import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatchAcknowledged } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerClearMocksTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'clear_mocks',
    {
      inputSchema: { targetId: z.string().optional().describe('Runtime target ID from list_targets.') },
      description:
        'Remove all mock rules. The command is applied inside selected runtime; application is acknowledged ' +
        'over the bridge. Affects DEV builds only.',
    },
    async (args) => {
      const sent = await dispatchAcknowledged(sender, args.targetId, { kind: 'mock.clear' })
      if (!sent) {
        return textResult({ sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ sent: true })
    },
  )
}
