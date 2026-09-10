import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { NetworkRequest } from 'hakka-core'

import { loadProxyConfiguration } from './mapping'
import { startProxyCapture, type ProxyCapture, type ProxyOptions } from './runner'

export interface ProxySessionStartOptions extends ProxyOptions {
  sessionId?: string
}

export interface ProxySessionStatus {
  sessionId: string
  state: 'stopped' | 'starting' | 'running' | 'failed'
  host?: string
  port?: number
  bridgeUrl?: string
  records: number
  diagnostics: string[]
  mappings: { mapLocal: number; mapRemote: number; headerRules: number; blockRules: number; delayRules: number }
  certificates: { configDir?: string; publicCaPath?: string; publicCaExists: boolean; privateKeyExposed: false }
  error?: string
}

interface Session {
  options: ProxySessionStartOptions
  capture?: ProxyCapture
  startup: Promise<ProxyCapture>
  stopping?: Promise<ProxySessionStatus>
  status: ProxySessionStatus
  stopRequested: boolean
}

/** Owns local sidecars for an MCP/desktop process. Mapping changes restart explicitly. */
export class ProxySessionManager {
  private readonly sessions = new Map<string, Session>()

  async start(options: ProxySessionStartOptions = {}): Promise<ProxySessionStatus> {
    const sessionId = options.sessionId ?? 'default'
    const current = this.sessions.get(sessionId)
    if (current?.status.state === 'running' || current?.status.state === 'starting')
      throw new Error(`Proxy session ${sessionId} is already running.`)
    const configDir = options.configDir ? resolve(options.configDir) : undefined
    const publicCaPath = configDir ? resolve(configDir, 'mitmproxy-ca-cert.pem') : undefined
    const mappings = loadProxyConfiguration(options.mapConfig)
    const status: ProxySessionStatus = {
      sessionId,
      state: 'starting',
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 8080,
      bridgeUrl: options.bridgeUrl ?? 'ws://localhost:8989',
      records: 0,
      diagnostics: [],
      mappings: {
        mapLocal: mappings.mapLocal.length,
        mapRemote: mappings.mapRemote.length,
        headerRules: mappings.rules.header,
        blockRules: mappings.rules.block,
        delayRules: mappings.rules.delay,
      },
      certificates: {
        configDir,
        publicCaPath,
        publicCaExists: publicCaPath ? existsSync(publicCaPath) : false,
        privateKeyExposed: false,
      },
    }
    let session: Session
    const startup = startProxyCapture({
      ...options,
      configDir,
      onRecord: (record) => this.record(session, record),
      onDiagnostic: (message) => this.diagnostic(session, message),
    })
    session = {
      options: { ...options, sessionId, configDir },
      startup,
      status,
      stopRequested: false,
    }
    this.sessions.set(sessionId, session)
    try {
      const capture = await startup
      session.capture = capture
      if (session.stopRequested) {
        await session.stopping
        return this.snapshot(status)
      }
      status.state = 'running'
      status.certificates.publicCaExists = publicCaPath ? existsSync(publicCaPath) : false
      void capture.wait().then(
        () => {
          if (status.state === 'running') status.state = 'stopped'
        },
        (error: Error) => {
          if (status.state === 'running') {
            status.state = 'failed'
            status.error = error.message
          }
        },
      )
      return this.snapshot(status)
    } catch (error) {
      if (session.stopRequested) {
        status.state = 'stopped'
        return this.snapshot(status)
      }
      status.state = 'failed'
      status.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  status(sessionId = 'default'): ProxySessionStatus {
    const session = this.sessions.get(sessionId)
    if (!session)
      return {
        sessionId,
        state: 'stopped',
        records: 0,
        diagnostics: [],
        mappings: { mapLocal: 0, mapRemote: 0, headerRules: 0, blockRules: 0, delayRules: 0 },
        certificates: { publicCaExists: false, privateKeyExposed: false },
      }
    const path = session.status.certificates.publicCaPath
    session.status.certificates.publicCaExists = path ? existsSync(path) : false
    return this.snapshot(session.status)
  }

  async stop(sessionId = 'default'): Promise<ProxySessionStatus> {
    const session = this.sessions.get(sessionId)
    if (!session) return this.status(sessionId)
    session.stopRequested = true
    session.stopping ??= (async () => {
      try {
        const capture = session.capture ?? (await session.startup)
        session.capture = capture
        await capture.stop()
        session.status.records = capture.records.length
      } catch (error) {
        // A startup that was cancelled before readiness has no live child left to stop.
        if (!session.stopRequested) throw error
      }
      session.status.state = 'stopped'
      return this.snapshot(session.status)
    })()
    return session.stopping
  }

  /** mitmproxy mapping flags are startup-only; callers must acknowledge the restart. */
  async updateMappings(sessionId: string, mapConfig: string | undefined, restart = false): Promise<ProxySessionStatus> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Proxy session ${sessionId} does not exist.`)
    loadProxyConfiguration(mapConfig)
    if (session.status.state === 'running' && !restart)
      throw new Error(
        'Changing proxy mappings requires restart: true because mitmproxy mapping flags apply at startup.',
      )
    const next = { ...session.options, mapConfig, sessionId }
    if (session.status.state === 'running') await this.stop(sessionId)
    return this.start(next)
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)))
  }

  private record(session: Session, _record: NetworkRequest): void {
    session.status.records = session.capture?.records.length ?? session.status.records + 1
  }
  private diagnostic(session: Session, message: string): void {
    session.status.diagnostics.push(message)
    if (session.status.diagnostics.length > 20) session.status.diagnostics.shift()
  }
  private snapshot(status: ProxySessionStatus): ProxySessionStatus {
    return {
      ...status,
      diagnostics: [...status.diagnostics],
      mappings: { ...status.mappings },
      certificates: { ...status.certificates },
    }
  }
}
