/**
 * `hakka/mcp` — programmatic entry point for the MCP stdio server.
 *
 *   import { main } from 'hakka/mcp'
 *   await main()
 *
 * IMPORTANT: `main()` connects an MCP stdio transport — once called, stdout
 * becomes the JSON-RPC channel. Never write to stdout after calling it.
 */
export { main, planServe, type ServePlan } from './server.js'

export { RequestStore } from './RequestStore.js'
export { createBridgeListener, parseBridgeFrame, DEFAULT_BRIDGE_URL, type BridgeListener } from './bridgeListener.js'
export { registerResources } from './resources.js'
export { registerTools, type ControlSender } from './tools/index.js'
