import { randomBytes } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { createServer, type Server, type Socket } from 'node:net'

import { parseControlCommand, redactHeaders, type BreakpointInput, type ControlCommand } from 'hakka-core'
import WebSocket from 'ws'

const MAX_LINE_BYTES = 64 * 1024
const MAX_PENDING_PAUSES = 64
const MAX_ADDON_CONNECTIONS = 64
const ADDON_AUTH_TIMEOUT_MS = 2_000

interface AddonPauseMessage {
  type: 'pause'
  pauseId: string
  ruleId?: string
  phase: 'request' | 'response'
  request: { url: string; method: string; headers: Record<string, string> }
  response?: { status: number; headers: Record<string, string> }
}

type AddonCommand =
  | { type: 'rules'; breakpoints: Array<BreakpointInput & { id: string }> }
  | { type: 'action'; pauseId: string; action: 'resume'; requestEdits?: object; responseEdits?: object }
  | { type: 'action'; pauseId: string; action: 'abort' }
  | { type: 'abort-all' }

export interface ProxyBreakpointBridgeOptions {
  bridgeUrl: string
  onDiagnostic?: (message: string) => void
  redactHeaders?: string[]
  /** Fires after both the desktop bridge and authenticated addon socket are connected. */
  onReady?: () => void
}

export interface ProxyBreakpointBridge {
  readonly addonPort: number
  readonly addonToken: string
  close(): Promise<void>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePause(value: unknown): AddonPauseMessage | null {
  if (!isObject(value) || value.type !== 'pause' || typeof value.pauseId !== 'string') return null
  if (value.phase !== 'request' && value.phase !== 'response') return null
  if (!isObject(value.request)) return null
  const request = value.request
  if (typeof request.url !== 'string' || typeof request.method !== 'string' || !isObject(request.headers)) return null
  if (!Object.values(request.headers).every((header) => typeof header === 'string')) return null
  let response: AddonPauseMessage['response']
  if (value.response !== undefined) {
    if (!isObject(value.response) || typeof value.response.status !== 'number' || !isObject(value.response.headers))
      return null
    if (!Object.values(value.response.headers).every((header) => typeof header === 'string')) return null
    response = { status: value.response.status, headers: value.response.headers as Record<string, string> }
  }
  if (value.phase === 'response' && !response) return null
  return {
    type: 'pause',
    pauseId: value.pauseId,
    ruleId: typeof value.ruleId === 'string' ? value.ruleId : undefined,
    phase: value.phase,
    request: {
      url: request.url,
      method: request.method,
      headers: request.headers as Record<string, string>,
    },
    response,
  }
}

function validHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return true
  try {
    for (const [name, value] of Object.entries(headers)) {
      validateHeaderName(name)
      validateHeaderValue(name, value)
    }
    return true
  } catch {
    return false
  }
}

function validEdits(
  command: Extract<ControlCommand, { kind: 'breakpoint.resume' }>,
  phase: 'request' | 'response',
): boolean {
  if (phase === 'request') {
    if (command.responseEdits || !validHeaders(command.requestEdits?.headers)) return false
    if (
      command.requestEdits?.method !== undefined &&
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(command.requestEdits.method)
    )
      return false
    if (command.requestEdits?.url !== undefined) {
      try {
        const protocol = new URL(command.requestEdits.url).protocol
        if (protocol !== 'http:' && protocol !== 'https:') return false
      } catch {
        return false
      }
    }
    return true
  }
  const status = command.responseEdits?.status
  return (
    !command.requestEdits &&
    validHeaders(command.responseEdits?.headers) &&
    (status === undefined || (Number.isInteger(status) && status >= 100 && status <= 999))
  )
}

function restoreRedactedHeaders(
  edited: Record<string, string> | undefined,
  original: Record<string, string>,
): Record<string, string> | null | undefined {
  if (!edited) return edited
  const originals = new Map(Object.entries(original).map(([name, value]) => [name.toLowerCase(), value]))
  const restored: Record<string, string> = {}
  for (const [name, value] of Object.entries(edited)) {
    if (value !== '[REDACTED]') restored[name] = value
    else {
      const originalValue = originals.get(name.toLowerCase())
      if (originalValue === undefined) return null
      restored[name] = originalValue
    }
  }
  return restored
}

/** Relays proxy breakpoint rules and live pause actions over Hakka's existing control envelope. */
export async function createProxyBreakpointBridge(
  options: ProxyBreakpointBridgeOptions,
): Promise<ProxyBreakpointBridge> {
  const bridgeURL = new URL(options.bridgeUrl)
  if (bridgeURL.protocol !== 'ws:' && bridgeURL.protocol !== 'wss:')
    throw new Error('Proxy breakpoint bridge URL must use ws:// or wss://.')
  const report = options.onDiagnostic ?? (() => {})
  const token = randomBytes(32).toString('hex')
  const rules = new Map<string, BreakpointInput & { id: string }>()
  const pending = new Map<string, AddonPauseMessage>()
  let addon: Socket | undefined
  let authenticated = false
  let stopped = false
  let websocket: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let readyAnnounced = false
  const acceptedSockets = new Set<Socket>()

  const announceReady = (): void => {
    if (readyAnnounced || !authenticated || websocket?.readyState !== WebSocket.OPEN) return
    readyAnnounced = true
    options.onReady?.()
  }

  const sendAddon = (command: AddonCommand): boolean => {
    if (!addon || !authenticated || addon.destroyed) return false
    const line = `${JSON.stringify(command)}\n`
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      report('Rejected an oversized proxy breakpoint command.')
      return false
    }
    addon.write(line)
    return true
  }
  const abortPending = (): void => {
    if (pending.size > 0) sendAddon({ type: 'abort-all' })
    pending.clear()
  }
  const replaceRules = (candidate: Map<string, BreakpointInput & { id: string }>): boolean => {
    const command = { type: 'rules' as const, breakpoints: [...candidate.values()] }
    if (Buffer.byteLength(`${JSON.stringify(command)}\n`, 'utf8') > MAX_LINE_BYTES) {
      report('Rejected a breakpoint update because proxy rule state exceeds 64 KiB.')
      return false
    }
    if (authenticated && !sendAddon(command)) return false
    rules.clear()
    for (const [id, rule] of candidate) rules.set(id, rule)
    return true
  }
  const sendRules = (): void => {
    sendAddon({ type: 'rules', breakpoints: [...rules.values()] })
  }
  const sendBridgeControl = (payload: object): void => {
    if (websocket?.readyState !== WebSocket.OPEN) {
      sendAddon({ type: 'action', pauseId: String((payload as { pauseId?: unknown }).pauseId ?? ''), action: 'abort' })
      return
    }
    websocket.send(JSON.stringify({ type: 'control', payload }))
  }
  const handleControl = (value: unknown): void => {
    const command = parseControlCommand(value)
    if (!command) return
    if (command.kind === 'breakpoint.add') {
      const candidate = new Map(rules)
      candidate.set(command.breakpoint.id, command.breakpoint)
      replaceRules(candidate)
      return
    }
    if (command.kind === 'breakpoint.remove') {
      const candidate = new Map(rules)
      candidate.delete(command.id)
      replaceRules(candidate)
      return
    }
    if (command.kind !== 'breakpoint.resume' && command.kind !== 'breakpoint.abort') return
    const pause = pending.get(command.pauseId)
    if (!pause) return
    if (command.kind === 'breakpoint.abort') {
      if (sendAddon({ type: 'action', pauseId: command.pauseId, action: 'abort' })) pending.delete(command.pauseId)
      return
    }
    const edits = pause.phase === 'request' ? command.requestEdits : command.responseEdits
    if (edits?.body !== undefined) {
      report(`Pause ${command.pauseId} remains held: proxy body edits are unavailable before transmission.`)
      return
    }
    if (!validEdits(command, pause.phase)) {
      report(`Pause ${command.pauseId} remains held: the proxy rejected invalid ${pause.phase} edits.`)
      return
    }
    const rawHeaders = pause.phase === 'request' ? pause.request.headers : pause.response!.headers
    const editedHeaders = restoreRedactedHeaders(edits?.headers, rawHeaders)
    if (editedHeaders === null) {
      report(`Pause ${command.pauseId} remains held: a redacted header has no original value.`)
      return
    }
    const requestEdits = command.requestEdits
      ? { ...command.requestEdits, ...(editedHeaders ? { headers: editedHeaders } : {}) }
      : undefined
    const responseEdits = command.responseEdits
      ? { ...command.responseEdits, ...(editedHeaders ? { headers: editedHeaders } : {}) }
      : undefined
    const addonCommand: AddonCommand = {
      type: 'action',
      pauseId: command.pauseId,
      action: 'resume',
      ...(requestEdits ? { requestEdits } : {}),
      ...(responseEdits ? { responseEdits } : {}),
    }
    if (sendAddon(addonCommand)) pending.delete(command.pauseId)
  }

  const connectWebSocket = (): void => {
    if (stopped) return
    const socket = new WebSocket(options.bridgeUrl, { maxPayload: MAX_LINE_BYTES })
    websocket = socket
    socket.on('open', announceReady)
    socket.on('message', (data) => {
      if (Buffer.byteLength(data.toString(), 'utf8') > MAX_LINE_BYTES) return
      try {
        const frame: unknown = JSON.parse(data.toString())
        if (isObject(frame) && frame.type === 'control') handleControl(frame.payload)
      } catch {
        // Other peers may send malformed frames; the bridge listener stays alive.
      }
    })
    socket.on('close', () => {
      if (websocket !== socket) return
      websocket = undefined
      readyAnnounced = false
      abortPending()
      rules.clear()
      sendRules()
      if (!stopped) reconnectTimer = setTimeout(connectWebSocket, 250)
    })
    socket.on('error', () => {})
  }

  const server: Server = createServer((socket) => {
    if (stopped || acceptedSockets.size >= MAX_ADDON_CONNECTIONS) {
      socket.destroy()
      return
    }
    acceptedSockets.add(socket)
    let socketAuthenticated = false
    let buffered = Buffer.alloc(0)
    const authenticationDeadline = setTimeout(() => {
      if (!socketAuthenticated) socket.destroy()
    }, ADDON_AUTH_TIMEOUT_MS)
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (buffered.length > MAX_LINE_BYTES && !buffered.includes(0x0a)) {
        report('Closed an addon connection after an oversized proxy breakpoint line.')
        socket.destroy()
        return
      }
      let newline = buffered.indexOf(0x0a)
      while (newline >= 0) {
        const raw = buffered.subarray(0, newline)
        buffered = buffered.subarray(newline + 1)
        if (raw.length > MAX_LINE_BYTES) {
          socket.destroy()
          return
        }
        let value: unknown
        try {
          value = JSON.parse(raw.toString('utf8'))
        } catch {
          newline = buffered.indexOf(0x0a)
          continue
        }
        if (!socketAuthenticated) {
          if (!isObject(value) || value.type !== 'auth' || value.token !== token) {
            socket.destroy()
            return
          }
          if (addon && !addon.destroyed) {
            socket.destroy()
            return
          }
          addon = socket
          socketAuthenticated = true
          authenticated = true
          readyAnnounced = false
          clearTimeout(authenticationDeadline)
          sendRules()
          announceReady()
        } else {
          if (isObject(value) && value.type === 'complete' && typeof value.pauseId === 'string') {
            pending.delete(value.pauseId)
            newline = buffered.indexOf(0x0a)
            continue
          }
          const pause = parsePause(value)
          if (pause) {
            if (pending.size >= MAX_PENDING_PAUSES) {
              report(`Aborted pause ${pause.pauseId}: the 64-pause proxy limit is full.`)
              sendAddon({ type: 'action', pauseId: pause.pauseId, action: 'abort' })
            } else if (!pending.has(pause.pauseId)) {
              pending.set(pause.pauseId, pause)
              sendBridgeControl({
                kind: 'breakpoint.paused',
                pauseId: pause.pauseId,
                ...(pause.ruleId ? { ruleId: pause.ruleId } : {}),
                phase: pause.phase,
                device: 'Proxy Capture',
                request: { ...pause.request, headers: redactHeaders(pause.request.headers, options.redactHeaders) },
                ...(pause.response
                  ? {
                      response: {
                        ...pause.response,
                        headers: redactHeaders(pause.response.headers, options.redactHeaders),
                        body: '',
                      },
                    }
                  : {}),
              })
            }
          }
        }
        newline = buffered.indexOf(0x0a)
      }
    })
    const disconnected = (): void => {
      clearTimeout(authenticationDeadline)
      acceptedSockets.delete(socket)
      if (addon !== socket) return
      addon = undefined
      authenticated = false
      readyAnnounced = false
      pending.clear()
    }
    socket.on('close', disconnected)
    socket.on('error', disconnected)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind proxy breakpoint control socket.')
  connectWebSocket()

  return {
    addonPort: address.port,
    addonToken: token,
    async close() {
      if (stopped) return
      stopped = true
      clearTimeout(reconnectTimer)
      abortPending()
      for (const socket of acceptedSockets) socket.destroy()
      acceptedSockets.clear()
      websocket?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
