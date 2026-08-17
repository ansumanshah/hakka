import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { type ControlSender, dispatch } from './controlDispatch.js'
import { buildMockRuleFromArgs } from './mockRuleArgs.js'
import { textResult } from './toolResult.js'

export function registerCreateMockTool(server: McpServer, sender: ControlSender): void {
  let mockIdCounter = 0

  server.registerTool(
    'create_mock',
    {
      description:
        'Create a mock/block/redirect rule for requests matching a URL pattern. The command is applied inside ' +
        'connected app(s); delivery is fire-and-forget over the bridge (no acknowledgment). Affects DEV builds only.',
      inputSchema: {
        pattern: z.string().min(1).describe('Substring to match against the request URL'),
        method: z.string().optional().describe('HTTP method filter (GET, POST, …). Omit to match all methods.'),
        mode: z
          .enum(['mock', 'block', 'redirect'])
          .optional()
          .default('mock')
          .describe('mock = serve a canned response; block = abort with a network error; redirect = rewrite the URL'),
        status: z
          .number()
          .int()
          .optional()
          .default(200)
          .describe('HTTP status for the mocked response (mode=mock only)'),
        body: z.string().optional().describe('Response body for the mocked response (mode=mock only)'),
        redirectTo: z.string().optional().describe('Target URL to redirect to (required when mode=redirect)'),
        delayMs: z.number().int().min(0).optional().describe('Artificial response delay in milliseconds'),
        modify: z
          .object({
            setRequestHeaders: z.record(z.string(), z.string()).optional(),
            removeRequestHeaders: z.array(z.string()).optional(),
            setQueryParams: z.record(z.string(), z.string()).optional(),
            removeQueryParams: z.array(z.string()).optional(),
            status: z.number().int().optional(),
            setResponseHeaders: z.record(z.string(), z.string()).optional(),
            removeResponseHeaders: z.array(z.string()).optional(),
            replaceBody: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
          })
          .optional()
          .describe(
            'Declarative edits applied to the REAL request/response (passthrough-then-transform): ' +
              'header set/remove, query set/remove, status override, plain-string body find/replace. ' +
              'Works on every platform. Combinable with mode=redirect; ignored for mode=block.',
          ),
      },
    },
    (args) => {
      const { pattern, method, mode = 'mock', status = 200, body, redirectTo, delayMs, modify } = args

      if (mode === 'redirect' && !redirectTo) {
        return textResult({ error: 'invalid_args', message: 'redirectTo is required when mode=redirect' }, true)
      }

      mockIdCounter++
      const id = `mcp-mock-${mockIdCounter}`

      const rule = buildMockRuleFromArgs(id, { pattern, method, mode, status, body, redirectTo, delayMs, modify })

      const sent = dispatch(sender, { kind: 'mock.add', rule })
      if (!sent) {
        return textResult({ id, sent: false, error: 'bridge_disconnected' }, true)
      }
      return textResult({ id, sent: true })
    },
  )
}
