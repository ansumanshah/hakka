/**
 * Central MCP tool registry — full tool descriptions and the `query` DSL
 * grammar live in docs/mcp/overview.mdx. Each tool's registration lives in
 * its own module in this folder; this file only composes them in order.
 * Write tools are agent-issued control commands relayed over the bridge to
 * the connected app(s) — fire-and-forget, DEV builds only.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { RequestStore } from '../RequestStore.js'
import type { SpanStore } from '../SpanStore.js'
import { registerClearTool } from './clear.js'
import { registerClearMocksTool } from './clearMocks.js'
import type { ControlSender } from './controlDispatch.js'
import { registerCreateMockTool } from './createMock.js'
import { registerDeleteBreakpointTool } from './deleteBreakpoint.js'
import { registerDeleteMockTool } from './deleteMock.js'
import { registerDiagnoseTool } from './diagnose.js'
import { registerExportEvidenceTool } from './exportEvidence.js'
import { registerGenerateMocksTool } from './generateMocks.js'
import { registerGenerateReproTool } from './generateRepro.js'
import { registerGenerateTestTool } from './generateTest.js'
import { registerGetRequestTool } from './getRequest.js'
import { registerGetTraceTool } from './getTrace.js'
import { registerListRequestsTool } from './listRequests.js'
import { registerPromoteCaptureToMockTool } from './promoteCaptureToMock.js'
import { registerReplayRequestTool } from './replayRequest.js'
import { registerSearchRequestsTool } from './searchRequests.js'
import { registerSetBreakpointTool } from './setBreakpoint.js'
import { registerSetThrottleTool } from './setThrottle.js'
import { registerStatsTool } from './stats.js'
import { registerVerifyFixTool } from './verifyFix.js'

export type { ControlSender } from './controlDispatch.js'

export function registerTools(
  server: McpServer,
  store: RequestStore,
  sender: ControlSender,
  spanStore: SpanStore,
): void {
  registerListRequestsTool(server, store)
  registerGetRequestTool(server, store)
  registerSearchRequestsTool(server, store)
  registerStatsTool(server, store)
  registerDiagnoseTool(server, store)
  registerClearTool(server, store)
  registerCreateMockTool(server, sender)
  registerPromoteCaptureToMockTool(server, store, sender)
  registerDeleteMockTool(server, sender)
  registerClearMocksTool(server, sender)
  registerSetBreakpointTool(server, sender)
  registerDeleteBreakpointTool(server, sender)
  registerSetThrottleTool(server, sender)
  registerGenerateMocksTool(server, store, sender)
  registerGenerateTestTool(server, store)
  registerGenerateReproTool(server, store)
  registerGetTraceTool(server, store, spanStore)
  registerExportEvidenceTool(server, store, spanStore)
  registerReplayRequestTool(server, store, sender)
  registerVerifyFixTool(server, store, sender)
}
