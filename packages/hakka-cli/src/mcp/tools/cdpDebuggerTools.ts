import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { createWsTransport } from '../../cdp/attach.js'
import { CdpDebugger } from '../../cdp/debugger.js'
import { textResult } from './toolResult.js'

/** Explicit CDP-only tools; never fall back to a browser bridge or page eval. */
export function registerCdpDebuggerTools(server: McpServer): () => Promise<void> {
  let pending: Promise<CdpDebugger> | undefined
  let closeConnection: (() => void) | undefined
  let closed = false
  const getDebugger = (): Promise<CdpDebugger> => {
    pending ??= (async () => {
      if (closed) throw new Error('Debugger tools have closed')
      const url = process.env.HAKKA_CDP_URL
      if (!url) throw new Error('HAKKA_CDP_URL must name an explicit Chromium page WebSocket')
      const connection = createWsTransport(url)
      const close = () => connection.socket.terminate()
      closeConnection = close
      connection.socket.once('close', () => {
        if (closeConnection !== close) return
        closeConnection = undefined
        pending = undefined
      })
      const timer = setTimeout(() => connection.socket.terminate(), 5000)
      try {
        await connection.ready
        const debuggerAdapter = new CdpDebugger(connection.transport)
        await debuggerAdapter.start()
        return debuggerAdapter
      } catch (error) {
        connection.socket.terminate()
        if (closeConnection === close) closeConnection = undefined
        pending = undefined
        throw error
      } finally {
        clearTimeout(timer)
      }
    })()
    return pending
  }
  const use = async <T>(action: (debuggerAdapter: CdpDebugger) => Promise<T> | T) => {
    try {
      return textResult(await action(await getDebugger()))
    } catch (error) {
      return textResult({ error: error instanceof Error ? error.message : String(error) }, true)
    }
  }
  server.registerTool(
    'cdp_list_scripts',
    {
      description: 'List parsed scripts from the Chromium target explicitly named by HAKKA_CDP_URL.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    (args) => use((d) => ({ scripts: d.listScripts(args.limit) })),
  )
  server.registerTool(
    'cdp_get_script_source',
    {
      description: 'Return bounded source for a parsed Chromium script. Does not evaluate it.',
      inputSchema: { scriptId: z.string().min(1), maxBytes: z.number().int().min(1).max(100000).optional() },
    },
    (args) => use((d) => d.getScriptSource(args.scriptId, args.maxBytes)),
  )
  server.registerTool(
    'cdp_set_breakpoint',
    {
      description: 'Set a line breakpoint in the explicitly attached Chromium target.',
      inputSchema: {
        scriptId: z.string().min(1),
        lineNumber: z.number().int().min(0),
        columnNumber: z.number().int().min(0).optional(),
      },
    },
    (args) => use((d) => d.setBreakpoint(args.scriptId, args.lineNumber, args.columnNumber)),
  )
  server.registerTool(
    'cdp_remove_breakpoint',
    { description: 'Remove a CDP breakpoint.', inputSchema: { breakpointId: z.string().min(1) } },
    (args) =>
      use(async (d) => {
        await d.removeBreakpoint(args.breakpointId)
        return { removed: args.breakpointId }
      }),
  )
  server.registerTool(
    'cdp_pause_state',
    { description: 'Read current paused frames from the explicit Chromium CDP target.', inputSchema: {} },
    () => use((d) => ({ paused: d.getPaused() ?? null })),
  )
  for (const [name, method] of [
    ['cdp_resume', 'resume'],
    ['cdp_step_over', 'stepOver'],
    ['cdp_step_into', 'stepInto'],
    ['cdp_step_out', 'stepOut'],
  ] as const)
    server.registerTool(
      name,
      { description: 'Control a currently paused explicit Chromium CDP target.', inputSchema: {} },
      () =>
        use(async (d) => {
          await d[method]()
          return { sent: true }
        }),
    )
  return async () => {
    closed = true
    const close = closeConnection
    closeConnection = undefined
    close?.()
    await pending?.catch(() => {})
    pending = undefined
  }
}
