import { constants } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { get as getHTTP } from 'node:http'
import { get as getHTTPS } from 'node:https'

import { createPacResolver } from 'pac-resolver'
import { QuickJS } from 'quickjs-wasi'

import {
  MAX_PAC_BYTES,
  normalizeProxyURL,
  type PacProxyRoutingConfig,
  type ProxyAuthentication,
} from './proxyRoutingConfig'

const PAC_DOWNLOAD_TIMEOUT_MS = 3_000
const PAC_EVALUATION_TIMEOUT_MS = 250
const PAC_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024

export interface ProxyRoute {
  kind: 'direct' | 'proxy'
  proxyURL?: string
  authentication?: ProxyAuthentication
}

export interface PacRouter {
  resolve(url: URL): Promise<ProxyRoute[]>
  close(): void
}

async function readBoundedPACFile(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const status = await handle.stat()
    if (!status.isFile()) throw new Error('PAC source must be a regular file.')
    if (status.size > MAX_PAC_BYTES) throw new Error(`PAC file must be at most ${MAX_PAC_BYTES} bytes.`)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function downloadPAC(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const client = new URL(url).protocol === 'https:' ? getHTTPS : getHTTP
    const request = client(
      url,
      {
        headers: { accept: 'application/x-ns-proxy-autoconfig, application/javascript' },
        signal: AbortSignal.timeout(PAC_DOWNLOAD_TIMEOUT_MS),
      },
      (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume()
          reject(new Error(`PAC URL returned HTTP ${response.statusCode ?? 'unknown'}.`))
          return
        }
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_PAC_BYTES) {
            request.destroy(new Error(`PAC response must be at most ${MAX_PAC_BYTES} bytes.`))
            return
          }
          chunks.push(chunk)
        })
        response.once('end', () => resolve(Buffer.concat(chunks)))
      },
    )
    request.setTimeout(PAC_DOWNLOAD_TIMEOUT_MS, () => request.destroy(new Error('PAC URL download timed out.')))
    request.once('error', reject)
  })
}

function parseDirective(
  value: string,
  authentication: ReadonlyMap<string, ProxyAuthentication>,
): ProxyRoute | undefined {
  const trimmed = value.trim()
  if (trimmed.toUpperCase() === 'DIRECT') return { kind: 'direct' }
  const match = trimmed.match(/^(PROXY|HTTP|HTTPS)\s+([^\s]+)$/i)
  if (!match) return undefined
  const scheme = match[1]!.toUpperCase() === 'HTTPS' ? 'https' : 'http'
  let normalized: string
  try {
    normalized = normalizeProxyURL(`${scheme}://${match[2]}`, 'PAC proxy')
  } catch {
    return undefined
  }
  return { kind: 'proxy', proxyURL: normalized, authentication: authentication.get(normalized) }
}

export async function createPacRouter(config: PacProxyRoutingConfig): Promise<PacRouter> {
  const source = 'file' in config.pac ? await readBoundedPACFile(config.pac.file) : await downloadPAC(config.pac.url)
  const wasm = await readFile(new URL('./quickjs.wasm', import.meta.resolve('quickjs-wasi/package.json')))
  let deadline = Number.POSITIVE_INFINITY
  const vm = await QuickJS.create({
    wasm,
    memoryLimit: PAC_MEMORY_LIMIT_BYTES,
    interruptHandler: () => Date.now() >= deadline,
  })
  let resolver: ReturnType<typeof createPacResolver>
  try {
    deadline = Date.now() + PAC_EVALUATION_TIMEOUT_MS
    resolver = createPacResolver(vm, source, { filename: 'hakka-proxy.pac' })
  } catch (error: unknown) {
    vm.dispose()
    throw new Error(`Could not compile PAC: ${error instanceof Error ? error.message : String(error)}`)
  }
  const credentials = new Map(
    (config.authentication ?? []).flatMap((endpoint) =>
      endpoint.authentication ? ([[endpoint.url, endpoint.authentication]] as const) : [],
    ),
  )
  let evaluation = Promise.resolve()
  return {
    resolve(url: URL): Promise<ProxyRoute[]> {
      const operation = evaluation.then(async () => {
        deadline = Date.now() + PAC_EVALUATION_TIMEOUT_MS
        let timer: ReturnType<typeof setTimeout> | undefined
        const result = await Promise.race([
          resolver(url),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('PAC evaluation timed out.')), PAC_EVALUATION_TIMEOUT_MS)
          }),
        ]).finally(() => clearTimeout(timer))
        const routes = result
          .split(';')
          .map((directive) => parseDirective(directive, credentials))
          .filter((route): route is ProxyRoute => route !== undefined)
        if (routes.length === 0) throw new Error('PAC returned no supported DIRECT, PROXY, HTTP, or HTTPS route.')
        return routes
      })
      evaluation = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
    close(): void {
      vm.dispose()
    },
  }
}
