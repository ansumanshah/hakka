import { randomBytes } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'

import {
  loadProxyScriptFile,
  PROXY_SCRIPT_MAX_BODY_BYTES,
  runProxyScriptHook,
  validateProxyScript,
  type ProxyScriptHookInput,
  type ProxyScriptHookResult,
  type ProxyScriptProgram,
} from './ProxyScriptSandbox'

const MAX_LINE_BYTES = 3 * PROXY_SCRIPT_MAX_BODY_BYTES
const AUTH_TIMEOUT_MS = 2_000
const MAX_CONNECTIONS = 8

export interface ProxyScriptBridgeOptions {
  scriptPath: string
  onDiagnostic?: (message: string) => void
  onReady?: () => void
}

export interface ProxyScriptBridge {
  readonly addonPort: number
  readonly addonToken: string
  readonly scriptPath: string
  close(): Promise<void>
}

type HookMessage = ProxyScriptHookInput & { type: 'hook'; id: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseHook(value: unknown): HookMessage | null {
  if (!isObject(value) || value.type !== 'hook' || typeof value.id !== 'string') return null
  if (value.phase === 'request' && isObject(value.request)) return value as unknown as HookMessage
  if (value.phase === 'response' && isObject(value.request) && isObject(value.response))
    return value as unknown as HookMessage
  return null
}

function writeResult(socket: Socket, id: string, result: ProxyScriptHookResult): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify({ type: 'result', id, ...result })}\n`)
}

/** Hosts an authenticated launch-local control socket for the bundled mitmproxy addon. */
export async function createProxyScriptBridge(options: ProxyScriptBridgeOptions): Promise<ProxyScriptBridge> {
  const program: ProxyScriptProgram = loadProxyScriptFile(options.scriptPath)
  await validateProxyScript(program)
  const token = randomBytes(32).toString('hex')
  const sockets = new Set<Socket>()
  let readyAnnounced = false
  let stopped = false
  const server: Server = createServer((socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    let authenticated = false
    let buffer = ''
    let chain = Promise.resolve()
    const authTimer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS)
    const processLine = async (line: string): Promise<void> => {
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        socket.destroy()
        return
      }
      if (!authenticated) {
        if (!isObject(value) || value.type !== 'auth' || value.token !== token) {
          socket.destroy()
          return
        }
        authenticated = true
        clearTimeout(authTimer)
        socket.write('{"type":"authenticated"}\n')
        if (!readyAnnounced) {
          readyAnnounced = true
          options.onReady?.()
        }
        return
      }
      const hook = parseHook(value)
      if (!hook) {
        socket.destroy()
        return
      }
      const result = await runProxyScriptHook(program, hook)
      if (result.outcome === 'error') options.onDiagnostic?.(result.diagnostic)
      writeResult(socket, hook.id, result)
    }
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
        socket.destroy()
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line)
          chain = chain
            .then(() => processLine(line))
            .catch(() => {
              socket.destroy()
            })
        newline = buffer.indexOf('\n')
      }
    })
    socket.once('close', () => {
      clearTimeout(authTimer)
      sockets.delete(socket)
    })
    socket.once('error', () => {})
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Proxy script helper did not bind a loopback port.')
  return {
    addonPort: address.port,
    addonToken: token,
    scriptPath: program.path,
    close: async () => {
      if (stopped) return
      stopped = true
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    },
  }
}
