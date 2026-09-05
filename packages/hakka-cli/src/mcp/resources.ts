/**
 * MCP resources exposed by hakka mcp.
 *
 * Resources:
 *   hakka://requests/recent  — the 50 most recent captured requests as JSON
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { scrubNetworkRequestForShare } from 'hakka-core'

import type { RequestStore } from './RequestStore.js'

export function registerResources(server: McpServer, store: RequestStore): void {
  server.registerResource(
    'recent_requests',
    'hakka://requests/recent',
    {
      description: 'The 50 most recent captured HTTP requests in the Hakka store, as a share-scrubbed JSON array.',
      mimeType: 'application/json',
    },
    (_uri) => {
      const requests = store.getAll({ limit: 50 }).map((request) => scrubNetworkRequestForShare(request).request)
      return {
        contents: [
          {
            uri: 'hakka://requests/recent',
            mimeType: 'application/json',
            text: JSON.stringify(requests),
          },
        ],
      }
    },
  )
}
