type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = Record<string, Json>

export class RequestFileValidationError extends Error {}

function fail(path: string, message: string): never {
  throw new RequestFileValidationError(`${path} ${message}`)
}
function object(value: Json | undefined, path: string): JsonObject {
  if (value == null || Array.isArray(value) || typeof value !== 'object') fail(path, 'must be an object')
  return value
}
function string(value: Json | undefined, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string')
  return value
}
function boolean(value: Json | undefined, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}
function array(value: Json | undefined, path: string): Json[] {
  if (!Array.isArray(value)) fail(path, 'must be an array')
  return value
}
function variant(value: Json | undefined, path: string, names: readonly string[]): [string, Json] {
  const result = object(value, path)
  const found = names.filter((name) => result[name] !== undefined)
  if (found.length !== 1) fail(path, `must contain exactly one of ${names.join(', ')}`)
  return [found[0]!, result[found[0]!]!]
}
function header(value: Json, path: string): void {
  const result = object(value, path)
  string(result.id, `${path}.id`)
  string(result.name, `${path}.name`)
  string(result.value, `${path}.value`)
  boolean(result.enabled, `${path}.enabled`)
}

function headers(value: Json | undefined, path: string): void {
  array(value, path).forEach((item, index) => header(item, `${path}[${index}]`))
}

function validateBody(value: Json | undefined): void {
  const [kind, payload] = variant(value, 'body', ['none', 'raw', 'form', 'multipart', 'graphql', 'file', 'grpcMessage'])
  switch (kind) {
    case 'none':
      object(payload, 'body.none')
      return
    case 'raw': {
      const raw = object(payload, 'body.raw')
      string(raw.text, 'body.raw.text')
      string(raw.contentType, 'body.raw.contentType')
      return
    }
    case 'form':
      array(object(payload, 'body.form')._0, 'body.form._0').forEach((item, index) =>
        header(item, `body.form._0[${index}]`),
      )
      return
    case 'multipart':
      array(object(payload, 'body.multipart')._0, 'body.multipart._0').forEach((item, index) => {
        const part = object(item, `body.multipart._0[${index}]`)
        string(part.id, `body.multipart._0[${index}].id`)
        string(part.name, `body.multipart._0[${index}].name`)
        string(part.value, `body.multipart._0[${index}].value`)
        boolean(part.enabled, `body.multipart._0[${index}].enabled`)
        if (part.filePath !== undefined && part.filePath !== null)
          string(part.filePath, `body.multipart._0[${index}].filePath`)
        if (part.contentType !== undefined && part.contentType !== null)
          string(part.contentType, `body.multipart._0[${index}].contentType`)
      })
      return
    case 'graphql': {
      const graphql = object(payload, 'body.graphql')
      string(graphql.query, 'body.graphql.query')
      string(graphql.variables, 'body.graphql.variables')
      if (graphql.operationName !== undefined && graphql.operationName !== null)
        string(graphql.operationName, 'body.graphql.operationName')
      return
    }
    case 'file': {
      const file = object(payload, 'body.file')
      string(file.path, 'body.file.path')
      string(file.contentType, 'body.file.contentType')
      return
    }
    case 'grpcMessage':
      string(object(payload, 'body.grpcMessage').hex, 'body.grpcMessage.hex')
  }
}

function validateNativeAuth(value: Json | undefined, path = 'auth'): void {
  const [kind, payload] = variant(value, path, ['inherit', 'none', 'basic', 'bearer', 'apiKey', 'oauth2'])
  if (kind === 'inherit' || kind === 'none') {
    object(payload, `${path}.${kind}`)
    return
  }
  if (kind === 'basic') {
    const basic = object(payload, `${path}.basic`)
    string(basic.username, `${path}.basic.username`)
    string(basic.password, `${path}.basic.password`)
    return
  }
  if (kind === 'bearer') {
    string(object(payload, `${path}.bearer`).token, `${path}.bearer.token`)
    return
  }
  if (kind === 'apiKey') {
    const apiKey = object(payload, `${path}.apiKey`)
    string(apiKey.name, `${path}.apiKey.name`)
    string(apiKey.value, `${path}.apiKey.value`)
    const placement = string(apiKey.placement, `${path}.apiKey.placement`)
    if (placement !== 'header' && placement !== 'query') fail(`${path}.apiKey.placement`, 'must be header or query')
    return
  }
  const oauth = object(object(payload, `${path}.oauth2`)._0, `${path}.oauth2._0`)
  if (oauth.grant === undefined) {
    string(oauth.accessToken, `${path}.oauth2._0.accessToken`)
    return
  }
  const [grant, grantPayload] = variant(oauth.grant, `${path}.oauth2._0.grant`, [
    'clientCredentials',
    'refreshToken',
    'authorizationCode',
    'staticToken',
  ])
  if (grant === 'staticToken') {
    string(
      object(grantPayload, `${path}.oauth2._0.grant.staticToken`).accessToken,
      `${path}.oauth2._0.grant.staticToken.accessToken`,
    )
    return
  }
  const config = object(grantPayload, `${path}.oauth2._0.grant.${grant}`)._0
  const fields = object(config, `${path}.oauth2._0.grant.${grant}._0`)
  string(fields.tokenURL, `${path}.oauth2._0.grant.${grant}._0.tokenURL`)
  string(fields.clientId, `${path}.oauth2._0.grant.${grant}._0.clientId`)
  if (grant === 'clientCredentials')
    string(fields.clientSecret, `${path}.oauth2._0.grant.clientCredentials._0.clientSecret`)
  if (grant === 'refreshToken') string(fields.refreshToken, `${path}.oauth2._0.grant.refreshToken._0.refreshToken`)
  if (grant === 'authorizationCode') {
    string(fields.authorizationURL, `${path}.oauth2._0.grant.authorizationCode._0.authorizationURL`)
    if (!Number.isInteger(fields.redirectPort))
      fail(`${path}.oauth2._0.grant.authorizationCode._0.redirectPort`, 'must be an integer')
  }
}

function validateTarget(value: Json | undefined, path: string): void {
  const [kind, payload] = variant(value, path, ['status', 'durationMs', 'header', 'jsonPath', 'bodyText'])
  if (kind === 'header') string(object(payload, `${path}.header`).name, `${path}.header.name`)
  else if (kind === 'jsonPath') string(object(payload, `${path}.jsonPath`)._0, `${path}.jsonPath._0`)
  else object(payload, `${path}.${kind}`)
}
function validateAssertions(value: Json | undefined): void {
  array(value, 'assertions').forEach((item, index) => {
    const assertion = object(item, `assertions[${index}]`)
    string(assertion.id, `assertions[${index}].id`)
    validateTarget(assertion.target, `assertions[${index}].target`)
    const op = string(assertion.op, `assertions[${index}].op`)
    if (
      ![
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'matches',
        'lessThan',
        'greaterThan',
        'exists',
        'notExists',
      ].includes(op)
    )
      fail(`assertions[${index}].op`, 'is not a supported assertion operator')
    string(assertion.expected, `assertions[${index}].expected`)
    boolean(assertion.enabled, `assertions[${index}].enabled`)
  })
}
function validateScripts(value: Json | undefined): void {
  const scripts = object(value, 'scripts')
  for (const key of ['preRequestLines', 'postResponseLines'])
    array(scripts[key], `scripts.${key}`).forEach((line, index) => string(line, `scripts.${key}[${index}]`))
}

/** Validates the portions of a request file authored by MCP against Swift Codable's persisted contract. */
export function validateNativeRequestFile(spec: JsonObject): void {
  validateBody(spec.body)
  validateNativeAuth(spec.auth)
  validateAssertions(spec.assertions)
  if (spec.scripts !== undefined && spec.scripts !== null) validateScripts(spec.scripts)
}

/** Validates the v4 root metadata before a CLI run or MCP write touches a collection tree. */
export function validateNativeCollectionMetadata(value: JsonObject): void {
  if (value.version !== undefined && !Number.isInteger(value.version)) fail('collection.version', 'must be an integer')
  if ((value.version as number | undefined) !== undefined && (value.version as number) > 4)
    fail('collection.version', 'requires a newer Hakka; supported format version 4')
  string(value.id, 'collection.id')
  string(value.name, 'collection.name')
  headers(value.defaultHeaders, 'collection.defaultHeaders')
  validateNativeAuth(value.auth, 'collection.auth')
  if (value.notes !== undefined && value.notes !== null) string(value.notes, 'collection.notes')
}

/** Validates folder metadata instead of treating malformed metadata as an absent folder. */
export function validateNativeFolderMetadata(value: JsonObject): void {
  if (!Number.isInteger(value.seq)) fail('folder.seq', 'must be an integer')
  string(value.id, 'folder.id')
  string(value.name, 'folder.name')
  headers(value.headers, 'folder.headers')
  validateNativeAuth(value.auth, 'folder.auth')
}

export function validateNativeRequestEnvelope(value: JsonObject): void {
  if (!Number.isInteger(value.seq)) fail('request.seq', 'must be an integer')
  validateNativeRequestFile(object(value.spec, 'request.spec'))
}
