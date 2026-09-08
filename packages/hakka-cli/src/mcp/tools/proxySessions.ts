import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ProxySessionManager } from '../../proxy/ProxySessionManager.js'
import { textResult } from './toolResult.js'

const sessionId = z.string().min(1).max(100).optional()

/** Registers local-only proxy lifecycle controls. It never changes OS trust or proxy settings. */
export function registerProxySessionTools(server: McpServer, sessions: ProxySessionManager): void {
  server.registerTool(
    'proxy_status',
    {
      description: 'Show a local Hakka proxy session status and public CA path, never private key material.',
      inputSchema: { sessionId },
    },
    ({ sessionId: id }) => textResult(sessions.status(id)),
  )
  server.registerTool(
    'proxy_start',
    {
      description:
        'Start a loopback Hakka proxy. LAN binding requires allowLan: true. Does not change system proxy or trust.',
      inputSchema: {
        sessionId,
        port: z.number().int().min(1).max(65535).optional(),
        host: z.string().optional(),
        allowLan: z.boolean().optional(),
        bridgeUrl: z.string().url().optional(),
        configDir: z.string().optional(),
        mapConfig: z.string().optional(),
        mitmdumpPath: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return textResult(await sessions.start(input))
      } catch (error) {
        return textResult(
          { error: error instanceof Error ? error.message : String(error), ...sessions.status(input.sessionId) },
          true,
        )
      }
    },
  )
  server.registerTool(
    'proxy_stop',
    { description: 'Stop a local Hakka proxy session and release its sidecar.', inputSchema: { sessionId } },
    async ({ sessionId: id }) => textResult(await sessions.stop(id)),
  )
  server.registerTool(
    'proxy_update_mappings',
    {
      description:
        'Update proxy mapping config. Running proxies require explicit restart: true because mappings apply at startup.',
      inputSchema: {
        sessionId: z.string().min(1).max(100),
        mapConfig: z.string().optional(),
        restart: z.boolean().optional(),
      },
    },
    async ({ sessionId: id, mapConfig, restart }) => {
      try {
        return textResult(await sessions.updateMappings(id, mapConfig, restart))
      } catch (error) {
        return textResult(
          { error: error instanceof Error ? error.message : String(error), ...sessions.status(id) },
          true,
        )
      }
    },
  )
}
