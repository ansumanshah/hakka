import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { textResult } from './toolResult.js'

export function registerClearMocksTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'clear_mocks',
    {
      description:
        'Remove all mock rules. The command is applied inside connected app(s); delivery is fire-and-forget ' +
        'over the bridge (no acknowledgment). Affects DEV builds only.',
    },
    (_extra) => {
      const sent = dispatch(sender, { kind: 'mock.clear' })
      if (!sent) {
        return textResult({ sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ sent: true })
    },
  )
}
