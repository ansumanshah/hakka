import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { RequestStore } from '../RequestStore.js'
import { textResult } from './toolResult.js'

export function registerClearTool(server: McpServer, store: RequestStore): void {
  server.registerTool(
    'clear',
    {
      description:
        'Clear all captured requests from the in-memory store. This does NOT disconnect the bridge or stop future capture — new requests will continue to arrive.',
    },
    (_extra) => {
      store.clear()
      return textResult({ ok: true })
    },
  )
}
