type FetchInput = Parameters<typeof globalThis.fetch>[0]

/** The parts of an outgoing fetch a breakpoint or rewrite rule actually changed. */
export interface FetchRequestChanges {
  url?: string
  method?: string
  headers?: Record<string, string>
  /** `null` clears the body; absent keeps the caller's original body object. */
  body?: string | null
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

/**
 * Apply only the changed parts of a request on top of the caller's own `input`/`init`, so the
 * original body object (FormData, Blob, stream), headers, signal, and credentials survive a
 * url-, method-, or header-only edit. A `Request` input is re-targeted with its own settings.
 */
export async function buildEditedFetchRequest(
  input: FetchInput,
  init: RequestInit | undefined,
  changes: FetchRequestChanges,
): Promise<{ input: FetchInput; init: RequestInit | undefined }> {
  const overrides: RequestInit = {}
  if (changes.method !== undefined) overrides.method = changes.method
  if (changes.headers !== undefined) overrides.headers = changes.headers
  if (changes.body !== undefined) overrides.body = changes.body ?? undefined

  const method = (changes.method ?? init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  // fetch() throws when a body rides on GET/HEAD — an edit to one of those drops it.
  if (BODYLESS_METHODS.has(method) && (init?.body != null || changes.body != null)) overrides.body = undefined

  if (!(input instanceof Request)) {
    return {
      input: changes.url ?? input,
      init: Object.keys(overrides).length > 0 ? { ...init, ...overrides } : init,
    }
  }

  if (changes.url === undefined) {
    return { input, init: { ...init, ...overrides } }
  }

  // A Request's URL can't be overridden through init: rebuild it at the new URL, carrying its
  // own method, headers, body bytes, and fetch settings; the caller's init still applies on top.
  const keepsBody = !('body' in overrides) && init?.body === undefined && !BODYLESS_METHODS.has(method)
  const body = keepsBody && input.body != null ? await input.arrayBuffer() : undefined
  const retargeted = new Request(changes.url, {
    method: input.method,
    headers: input.headers,
    body,
    signal: input.signal,
    credentials: input.credentials,
    cache: input.cache,
    redirect: input.redirect,
    referrerPolicy: input.referrerPolicy,
    integrity: input.integrity,
    keepalive: input.keepalive,
    mode: input.mode === 'navigate' ? undefined : input.mode,
  })
  const merged = { ...init, ...overrides }
  return { input: retargeted, init: Object.keys(merged).length > 0 ? merged : undefined }
}
