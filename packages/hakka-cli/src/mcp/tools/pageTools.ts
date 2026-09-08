import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlCommand } from 'hakka-core'
import { z } from 'zod'

import type { ControlSender } from './controlDispatch.js'
import { textResult } from './toolResult.js'

async function request(sender: ControlSender, targetId: string | undefined, command: ControlCommand) {
  if (!sender.connected || !sender.requestControl) return { status: 'failed' as const, error: 'bridge_disconnected' }
  return sender.requestControl(command, targetId)
}

/** Page inspection and reversible edits. These require a browser runtime advertising page capabilities. */
export function registerPageTools(server: McpServer, sender: ControlSender): void {
  server.registerTool(
    'inspect_page',
    {
      description:
        'Inspect a bounded DOM outline or CSS selector in a connected browser runtime. This does not evaluate page JavaScript.',
      inputSchema: {
        targetId: z.string().optional(),
        selector: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      const result = await request(sender, args.targetId, {
        kind: 'page.inspect',
        selector: args.selector,
        limit: args.limit,
      })
      return textResult(
        result.status === 'applied' ? (result.data ?? {}) : { error: result.error },
        result.status !== 'applied',
      )
    },
  )

  server.registerTool(
    'edit_page',
    {
      description:
        'Apply one reversible DOM text, attribute, or inline CSS edit. The browser must explicitly opt in to remote page edits; use undo_page with returned changeId.',
      inputSchema: {
        targetId: z.string().optional(),
        selector: z.string().min(1).max(512),
        text: z.string().max(4096).optional(),
        attribute: z.object({ name: z.string().min(1).max(128), value: z.string().max(4096).optional() }).optional(),
        style: z.object({ name: z.string().min(1).max(128), value: z.string().max(4096).optional() }).optional(),
      },
    },
    async (args) => {
      const count = [args.text !== undefined, args.attribute !== undefined, args.style !== undefined].filter(
        Boolean,
      ).length
      if (count !== 1) return textResult({ error: 'provide exactly one of text, attribute, or style' }, true)
      const result = await request(sender, args.targetId, {
        kind: 'page.edit',
        selector: args.selector,
        text: args.text,
        attribute: args.attribute,
        style: args.style,
      })
      return textResult(
        result.status === 'applied' ? (result.data ?? {}) : { error: result.error },
        result.status !== 'applied',
      )
    },
  )

  server.registerTool(
    'undo_page',
    {
      description: 'Undo one edit_page change by its changeId.',
      inputSchema: { targetId: z.string().optional(), changeId: z.string().min(1).max(64) },
    },
    async (args) => {
      const result = await request(sender, args.targetId, { kind: 'page.undo', changeId: args.changeId })
      return textResult(
        result.status === 'applied' ? (result.data ?? {}) : { error: result.error },
        result.status !== 'applied',
      )
    },
  )
}
