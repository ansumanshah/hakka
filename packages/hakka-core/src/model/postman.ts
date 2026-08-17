/**
 * Postman Collection v2.1 export.
 *
 * Turns captured requests into a `.postman_collection.json` that imports directly
 * into Postman / Insomnia / Hoppscotch — the frictionless handoff from passive
 * capture (Hakka) to request authoring/replay (an API client).
 */
import type { NetworkRequest } from './types'

interface PostmanHeader {
  key: string
  value: string
}

interface PostmanBody {
  mode: 'raw'
  raw: string
}

export interface PostmanRequest {
  method: string
  header: PostmanHeader[]
  url: string
  body?: PostmanBody
}

export interface PostmanItem {
  name: string
  request: PostmanRequest
  response: never[]
}

export interface PostmanCollection {
  info: {
    name: string
    schema: string
    _postman_id?: string
  }
  item: PostmanItem[]
}

export interface PostmanExportOptions {
  /** Collection name shown in Postman. Default: "Hakka Export". */
  name?: string
}

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}

/** Convert a single captured request to a Postman collection item. */
export const requestToPostmanItem = (request: NetworkRequest): PostmanItem => {
  const method = request.method.toUpperCase()
  const header: PostmanHeader[] = Object.entries(request.requestHeaders ?? {}).map(([key, value]) => ({ key, value }))
  const item: PostmanItem = {
    name: `${method} ${pathOf(request.url)}`,
    request: { method, header, url: request.url },
    response: [],
  }
  if (request.requestBody != null && request.requestBody !== '') {
    item.request.body = { mode: 'raw', raw: request.requestBody }
  }
  return item
}

/** Build a Postman Collection v2.1 object from captured requests. */
export const buildPostmanCollection = (
  requests: NetworkRequest[],
  options?: PostmanExportOptions,
): PostmanCollection => ({
  info: { name: options?.name ?? 'Hakka Export', schema: SCHEMA },
  item: requests.map(requestToPostmanItem),
})

/** Serialize captured requests to a Postman Collection v2.1 JSON string. */
export const exportPostmanString = (requests: NetworkRequest[], options?: PostmanExportOptions): string =>
  JSON.stringify(buildPostmanCollection(requests, options), null, 2)
