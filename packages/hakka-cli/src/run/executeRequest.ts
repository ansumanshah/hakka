import { assertionResult, sourceValue } from './assertions.js'
import { credentialValues } from './credentialValues.js'
import { applyAuth } from './requestAuth.js'
import { decodeBody } from './requestBody.js'
import { runScript } from './requestScripts.js'
import { readResponseBody } from './responseBody.js'
import { sessionSignal } from './transportLimits.js'
import { executeGrpc, executeWebSocket, executeSse } from './transports.js'
import type { LoadedRequest, RunItem } from './types.js'
import { throwIfAborted, object, text, interpolate, unresolved, safeText, enabled } from './values.js'
export async function execute(
  item: LoadedRequest,
  variables: Record<string, string>,
  defaultTimeout: number,
  parentSignal?: AbortSignal,
): Promise<RunItem> {
  // Scripts may mutate a request, but a dataset iteration must never leak that mutation into the next one.
  const request = structuredClone(item.request)
  const secrets = [
    ...Object.values(variables),
    ...credentialValues(request),
    ...credentialValues(item.auth),
    ...credentialValues(item.headers),
  ]
  const timeoutMs = Math.round((request.timeout ?? defaultTimeout / 1000) * 1000)
  const signal = sessionSignal(timeoutMs, parentSignal)
  try {
    throwIfAborted(signal)
    const rawBody = object(object(request.body).raw)
    const preSource = object(request.scripts).preRequestLines
    const preLines = Array.isArray(preSource)
      ? preSource.filter((line): line is string => typeof line === 'string')
      : []
    const pre = await runScript(
      preLines,
      {
        env: variables,
        request: {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(
            (request.headers ?? [])
              .filter((header) => header.enabled !== false)
              .map((header) => [header.name, header.value]),
          ),
          body: text(rawBody.text),
        },
      },
      Math.min(defaultTimeout, 5_000),
      signal,
    )
    Object.assign(variables, pre.variables)
    if (pre.request) {
      request.method = pre.request.method
      request.url = pre.request.url
      request.headers = Object.entries(pre.request.headers).map(([name, value]) => ({ name, value }))
      if (pre.request.body != null && (Object.keys(rawBody).length || 'none' in object(request.body)))
        request.body = { raw: { text: pre.request.body, contentType: text(rawBody.contentType) ?? 'text/plain' } }
    }
  } catch (error) {
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error: safeText(error instanceof Error ? error.message : 'script failed', [
        ...secrets,
        ...Object.values(variables),
      ]),
    }
  }
  const urlText = interpolate(request.url, variables)
  const missing = [
    ...new Set(unresolved(JSON.stringify({ url: request.url, headers: item.headers, request, auth: item.auth }))),
  ].filter((key) => variables[key] == null)
  if (missing.length)
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error: `missing variables: ${missing.join(', ')}`,
    }
  try {
    const url = new URL(urlText)
    if (!['http:', 'https:', 'ws:', 'wss:', 'grpc:', 'grpcs:'].includes(url.protocol))
      throw new Error(`unsupported protocol ${url.protocol}`)
    const sessionVariants = Number(Boolean(request.session?.webSocket)) + Number(Boolean(request.session?.sse))
    if (request.session && sessionVariants !== 1) throw new Error('requests may contain exactly one session variant')
    if ((url.protocol === 'ws:' || url.protocol === 'wss:') && !request.session?.webSocket)
      throw new Error('WebSocket requests require a webSocket session')
    if (request.session?.webSocket && url.protocol !== 'ws:' && url.protocol !== 'wss:')
      throw new Error('webSocket sessions require a ws:// or wss:// URL')
    if (request.session?.sse && url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('SSE sessions require an http:// or https:// URL')
    const headers = new Headers()
    for (const pair of [...item.headers, ...(request.headers ?? [])])
      if (pair.enabled !== false) headers.set(interpolate(pair.name, variables), interpolate(pair.value, variables))
    for (const pair of request.query ?? [])
      if (pair.enabled !== false)
        url.searchParams.set(interpolate(pair.name, variables), interpolate(pair.value, variables))
    await applyAuth(
      request.auth && !('inherit' in request.auth) ? request.auth : item.auth,
      headers,
      url,
      variables,
      signal,
    )
    const encoded =
      url.protocol === 'grpc:' || url.protocol === 'grpcs:' ? {} : await decodeBody(request.body, variables, item.root)
    if (encoded.contentType && !headers.has('content-type')) headers.set('content-type', encoded.contentType)
    const controller = new AbortController()
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.round((request.timeout ?? defaultTimeout / 1000) * 1000)),
    )
    const started = performance.now()
    let response: Response
    let responseStatus: number | undefined
    try {
      if (url.protocol === 'grpc:' || url.protocol === 'grpcs:') {
        const grpc = object(object(request.body).grpcMessage)
        const hex = text(grpc.hex)
        if (hex === undefined) throw new Error('gRPC requests require a grpcMessage body')
        const result = await executeGrpc(
          url,
          headers,
          interpolate(hex, variables),
          Math.max(1, Math.round((request.timeout ?? defaultTimeout / 1000) * 1000)),
          requestSignal,
        )
        response = new Response(result.body, { status: result.status, headers: result.headers })
        responseStatus = result.status
      } else if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        if (!request.session?.webSocket || request.session.sse)
          throw new Error('WebSocket requests require exactly one webSocket session')
        const result = await executeWebSocket(
          url,
          headers,
          {
            ...request.session.webSocket,
            sendFrames: request.session.webSocket.sendFrames.map((frame) => ({
              ...frame,
              data: interpolate(frame.data, variables),
            })),
          },
          requestSignal,
        )
        response = new Response(result.body, { status: 200, headers: result.headers })
        responseStatus = result.status
      } else if (request.session?.sse) {
        if (request.session.webSocket) throw new Error('requests may contain exactly one session variant')
        const result = await executeSse(url, headers, request.session.sse, requestSignal)
        response = new Response(result.body, { status: result.status, headers: result.headers })
        responseStatus = result.status
      } else
        response = await fetch(url, {
          method: request.method,
          headers,
          body: encoded.body,
          redirect: request.followRedirects === false ? 'manual' : 'follow',
          signal: requestSignal,
        })
      if (responseStatus === undefined) responseStatus = response.status
    } catch (error) {
      clearTimeout(timeout)
      throw error
    }
    const responseBody = await readResponseBody(response, controller)
    clearTimeout(timeout)
    const durationMs = Math.round(performance.now() - started)
    const failures = (request.assertions ?? [])
      .map((assertion) =>
        assertionResult(assertion, responseStatus!, durationMs, response.headers, responseBody, variables),
      )
      .filter((value): value is string => value != null)
    for (const capture of request.captures ?? [])
      if (enabled(capture)) {
        const value = sourceValue(object(capture.source), responseStatus!, durationMs, response.headers, responseBody)
        const key = text(capture.variable)
        if (key && value != null) variables[key] = value
      }
    try {
      const postSource = object(request.scripts).postResponseLines
      const postLines = Array.isArray(postSource)
        ? postSource.filter((line): line is string => typeof line === 'string')
        : []
      const post = await runScript(
        postLines,
        {
          env: variables,
          response: {
            status: responseStatus!,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
          },
        },
        Math.min(defaultTimeout, 5_000),
        signal,
      )
      Object.assign(variables, post.variables)
    } catch (error) {
      failures.push(
        safeText(error instanceof Error ? error.message : 'post-response script failed', [
          ...secrets,
          ...Object.values(variables),
        ]),
      )
    }
    return {
      name: request.name,
      id: request.id,
      status: responseStatus!,
      durationMs,
      outcome: failures.length ? 'failed' : 'passed',
      assertions: failures,
    }
  } catch (error) {
    const message =
      error instanceof Error ? safeText(error.message, [...secrets, ...Object.values(variables)]) : 'request failed'
    return {
      name: request.name,
      id: request.id,
      durationMs: 0,
      outcome: 'error',
      assertions: [],
      error:
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
          ? parentSignal?.aborted
            ? 'run cancelled'
            : 'request timed out'
          : message,
    }
  }
}
