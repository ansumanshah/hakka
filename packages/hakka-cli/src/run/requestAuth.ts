import { readResponseBody } from './responseBody.js'
import type { ObjectJson } from './types.js'
import { object, text, interpolate, throwIfAborted } from './values.js'
function associated(value: ObjectJson): ObjectJson {
  return value._0 === undefined ? value : object(value._0)
}
async function oauthToken(
  config: ObjectJson,
  variables: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const grant = object(config.grant)
  const staticToken = object(grant.staticToken)
  if (Object.keys(staticToken).length) return interpolate(text(staticToken.accessToken) ?? '', variables)
  const client = associated(object(grant.clientCredentials))
  const refresh = associated(object(grant.refreshToken))
  if (!Object.keys(client).length && !Object.keys(refresh).length) {
    if (Object.keys(object(grant.authorizationCode)).length)
      throw new Error(
        'OAuth authorization-code requests require an interactive desktop session; hakka run is noninteractive',
      )
    throw new Error('unsupported OAuth2 grant')
  }
  const source = Object.keys(client).length ? client : refresh
  const params = new URLSearchParams({
    grant_type: Object.keys(client).length ? 'client_credentials' : 'refresh_token',
    client_id: interpolate(text(source.clientId) ?? '', variables),
  })
  const secret = text(source.clientSecret)
  if (secret) params.set('client_secret', interpolate(secret, variables))
  if (Object.keys(refresh).length) {
    const rotated = text(config.refreshTokenVariable)
    params.set(
      'refresh_token',
      (rotated ? variables[rotated] : undefined) ?? interpolate(text(refresh.refreshToken) ?? '', variables),
    )
  }
  const scope = text(source.scope)
  if (scope) params.set('scope', interpolate(scope, variables))
  const response = await fetch(interpolate(text(source.tokenURL) ?? '', variables), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal,
  })
  const body = await readResponseBody(response)
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error('OAuth token endpoint returned invalid JSON')
  }
  const values = payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  if (!response.ok || typeof values.access_token !== 'string' || !values.access_token)
    throw new Error('OAuth token endpoint did not return an access token')
  variables[text(config.accessTokenVariable) ?? 'oauth2_access_token'] = values.access_token
  const refreshKey = text(config.refreshTokenVariable)
  if (refreshKey && typeof values.refresh_token === 'string') variables[refreshKey] = values.refresh_token
  return values.access_token
}

export async function applyAuth(
  auth: ObjectJson,
  headers: Headers,
  url: URL,
  variables: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  if ('inherit' in auth || 'none' in auth || Object.keys(auth).length === 0) return
  const basic = object(auth.basic)
  if (Object.keys(basic).length) {
    headers.set(
      'Authorization',
      `Basic ${Buffer.from(`${interpolate(text(basic.username) ?? '', variables)}:${interpolate(text(basic.password) ?? '', variables)}`).toString('base64')}`,
    )
    return
  }
  const bearer = object(auth.bearer)
  if (Object.keys(bearer).length) {
    headers.set('Authorization', `Bearer ${interpolate(text(bearer.token) ?? '', variables)}`)
    return
  }
  const apiKey = object(auth.apiKey)
  if (Object.keys(apiKey).length) {
    const name = interpolate(text(apiKey.name) ?? '', variables)
    const value = interpolate(text(apiKey.value) ?? '', variables)
    if (text(apiKey.placement) === 'query') url.searchParams.set(name, value)
    else headers.set(name, value)
    return
  }
  const oauth2 = associated(object(auth.oauth2))
  if (Object.keys(oauth2).length) {
    const legacy = text(oauth2.accessToken)
    headers.set(
      'Authorization',
      `Bearer ${legacy === undefined ? await oauthToken(oauth2, variables, signal) : interpolate(legacy, variables)}`,
    )
    return
  }
  throw new Error(`unsupported auth type in runner (${Object.keys(auth).join(', ')})`)
}
