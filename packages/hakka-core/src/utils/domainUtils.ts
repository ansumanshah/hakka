import type { NetworkRequest } from '../model/types'
import { parseUrl } from './urlParser'

/** Drop the port. An IPv6 literal keeps colons of its own, so its port lives after the `]`. */
const hostnameOf = (host: string): string =>
  host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '')

/** Goes through `parseUrl`, never the ambient `URL` — see docs/concepts/url-parsing.md. */
export const extractHost = (url: string): string => {
  const { host } = parseUrl(url)
  return host ? hostnameOf(host) : 'unknown'
}

/**
 * Strict variant of `extractHost` for `getUniqueDomains`: returns null for non-http(s)
 * captures (`exp://`, a custom bridge scheme) instead of `extractHost`'s lenient fallback,
 * so those don't leak into the domain chip list.
 */
function extractHttpHost(url: string): string | null {
  const { host, protocol } = parseUrl(url)
  if (protocol !== 'http:' && protocol !== 'https:') return null
  return hostnameOf(host) || null
}

export const getUniqueDomains = (logs: NetworkRequest[]): string[] => {
  const domains = new Set<string>()
  logs.forEach((log) => {
    const host = extractHttpHost(log.url)
    if (host) domains.add(host)
  })
  return Array.from(domains).sort()
}

export interface DomainStats {
  domain: string
  totalRequests: number
  successRate: number
  failureRate: number
  informationalRate: number
  averageResponseTime: number
  fastestRequest: number
  slowestRequest: number
  dataSent: number
  dataReceived: number
  methodBreakdown: Record<string, number>
  statusCodeDistribution: Record<number, number>
}

export const calculateDomainStats = (logs: NetworkRequest[], domain: string): DomainStats => {
  let totalRequests = 0
  let successCount = 0
  let failureCount = 0
  let informationalCount = 0
  let dataSent = 0
  let dataReceived = 0
  let durationCount = 0
  let durationTotal = 0
  let fastestRequest = Number.POSITIVE_INFINITY
  let slowestRequest = 0
  const methodBreakdown: Record<string, number> = {}
  const statusCodeDistribution: Record<number, number> = {}

  for (const log of logs) {
    if (extractHost(log.url) !== domain) continue

    totalRequests += 1
    dataSent += log.requestBody?.length || 0
    dataReceived += log.size || 0

    const method = log.method.toUpperCase()
    methodBreakdown[method] = (methodBreakdown[method] || 0) + 1

    if (log.status && log.status > 0) {
      statusCodeDistribution[log.status] = (statusCodeDistribution[log.status] || 0) + 1
    }
    if (log.status && log.status >= 200 && log.status < 300) {
      successCount += 1
    }
    if (log.status && log.status >= 400) {
      failureCount += 1
    }
    if (log.status && log.status >= 100 && log.status < 200) {
      informationalCount += 1
    }

    const duration = log.duration || 0
    if (duration > 0) {
      durationCount += 1
      durationTotal += duration
      fastestRequest = Math.min(fastestRequest, duration)
      slowestRequest = Math.max(slowestRequest, duration)
    }
  }

  const successRate = totalRequests > 0 ? successCount / totalRequests : 0
  const failureRate = totalRequests > 0 ? failureCount / totalRequests : 0
  const informationalRate = totalRequests > 0 ? informationalCount / totalRequests : 0
  const averageResponseTime = durationCount > 0 ? durationTotal / durationCount : 0

  return {
    domain,
    totalRequests,
    successRate,
    failureRate,
    informationalRate,
    averageResponseTime,
    fastestRequest: durationCount > 0 ? fastestRequest : 0,
    slowestRequest,
    dataSent,
    dataReceived,
    methodBreakdown,
    statusCodeDistribution,
  }
}
