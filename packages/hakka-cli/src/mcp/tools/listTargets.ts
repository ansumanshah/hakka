import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { ControlSender } from './controlDispatch'
import { textResult } from './toolResult'

export function registerListTargetsTool(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'list_targets',
    {
      description:
        'List connected runtime identities and supported control capabilities. Select an id for mutations when multiple peers are connected. Legacy peers remain readable but cannot acknowledge control.',
    },
    () => textResult({ connected: sender.connected, targets: sender.getTargets?.() ?? [] }),
  )
}
