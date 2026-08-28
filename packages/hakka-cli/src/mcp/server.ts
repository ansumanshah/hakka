// IMPORTANT: stdout is the JSON-RPC channel — all diagnostic output must go to stderr only.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BRIDGE_PORT, startBridgeServer, type BridgeServer } from 'hakka-bridge'

import { createBridgeListener, DEFAULT_BRIDGE_URL } from './bridgeListener.js'
import { RequestStore } from './RequestStore.js'
import { registerResources } from './resources.js'
import { SpanStore } from './SpanStore.js'
import { registerTools } from './tools/index.js'

interface CliOptions {
  url?: string
  /** undefined = no explicit flag (fall back to env / default) */
  serve?: boolean
}

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2)
  const opts: CliOptions = {}
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--url' || argv[i] === '--port') && argv[i + 1]) {
      const val = argv[i + 1]
      opts.url = argv[i] === '--port' ? `ws://localhost:${val}` : val
      i++
    } else if (argv[i] === '--no-serve') {
      opts.serve = false
    } else if (argv[i] === '--serve') {
      opts.serve = true
    }
  }
  return opts
}

export interface ServePlan {
  host: string
  port: number
  shouldServe: boolean
}

/** Decide whether to host a bridge hub: only loopback/local hosts are hostable; never throws (bad URL falls back to local default). */
export function planServe(bridgeUrl: string, serve: boolean): ServePlan {
  let host = 'localhost'
  let port = DEFAULT_BRIDGE_PORT
  try {
    const u = new URL(bridgeUrl)
    if (u.hostname) host = u.hostname
    if (u.port) port = Number.parseInt(u.port, 10) || port
  } catch {
    // keep local defaults
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  return { host, port, shouldServe: serve && isLocal }
}

export async function main(): Promise<void> {
  const cli = parseArgs()
  const bridgeUrl = cli.url ?? process.env.HAKKA_BRIDGE_URL ?? DEFAULT_BRIDGE_URL
  const capacity = parseInt(process.env.HAKKA_MCP_MAX_REQUESTS ?? '500', 10) || 500
  const envServeDisabled = process.env.HAKKA_MCP_SERVE === '0' || process.env.HAKKA_MCP_SERVE === 'false'
  const serve = cli.serve ?? !envServeDisabled
  const plan = planServe(bridgeUrl, serve)

  const store = new RequestStore(capacity)
  const spanStore = new SpanStore(capacity)

  // If the port is already taken (another hub running), fall back to a pure client.
  let hostedHub: BridgeServer | undefined
  if (plan.shouldServe) {
    try {
      hostedHub = await startBridgeServer({ port: plan.port })
      process.stderr.write(
        `[hakka] hosting a bridge hub on ws://localhost:${hostedHub.port} — point your app here (no separate hakka-bridge needed)\n`,
      )
    } catch {
      process.stderr.write(
        `[hakka] a bridge hub is already running on port ${plan.port} — connecting to it as a client\n`,
      )
    }
  }

  const server = new McpServer({
    name: 'hakka',
    version: '0.1.0',
  })

  const listener = createBridgeListener(store, bridgeUrl, spanStore)

  registerTools(server, store, listener, spanStore)
  registerResources(server, store)

  const shutdown = (): void => {
    process.stderr.write('[hakka] shutting down\n')
    listener.close()
    hostedHub?.close().catch(() => {})
    server.close().catch(() => {})
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(
    `[hakka] ready (bridge=${bridgeUrl}, capacity=${capacity}, hosting=${hostedHub ? 'yes' : 'no'})\n`,
  )
}
