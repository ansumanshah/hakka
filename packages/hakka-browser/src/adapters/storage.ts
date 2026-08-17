/**
 * Browser storage adapter — reads localStorage, sessionStorage, and document.cookie.
 * Excludes keys prefixed with `hakka:` (internal state).
 * SSR-guarded (no-ops when DOM APIs are unavailable).
 */

export interface KV {
  key: string
  value: string
}

export interface StorageSnapshot {
  local: KV[]
  session: KV[]
  cookies: KV[]
}

export type StorageArea = 'local' | 'session' | 'cookies'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function readStorageArea(store: Storage): KV[] {
  const result: KV[] = []
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key === null || key.startsWith('hakka:')) continue
      const value = store.getItem(key) ?? ''
      result.push({ key, value })
    }
  } catch {
    // Storage may be inaccessible (private mode, cross-origin, etc.)
  }
  return result
}

function readCookies(): KV[] {
  if (!isBrowser()) return []
  try {
    const raw = document.cookie
    if (!raw) return []
    return raw
      .split(';')
      .map((part) => {
        const eqIdx = part.indexOf('=')
        if (eqIdx === -1) return null
        const key = part.slice(0, eqIdx).trim()
        const value = part.slice(eqIdx + 1).trim()
        if (key.startsWith('hakka:')) return null
        return { key, value }
      })
      .filter((x): x is KV => x !== null)
  } catch {
    return []
  }
}

/** Read all storage areas, excluding `hakka:` prefixed keys. */
export function readStorage(): StorageSnapshot {
  if (!isBrowser()) return { local: [], session: [], cookies: [] }
  return {
    local: readStorageArea(localStorage),
    session: readStorageArea(sessionStorage),
    cookies: readCookies(),
  }
}

/** Write (create or overwrite) a single localStorage/sessionStorage item. */
export function setStorageItem(area: 'local' | 'session', key: string, value: string): void {
  if (!isBrowser()) return
  if (!key) return
  try {
    if (area === 'local') {
      localStorage.setItem(key, value)
    } else {
      sessionStorage.setItem(key, value)
    }
  } catch {
    // no-op: Storage may be read-only or over quota
  }
}

export interface SetCookieOptions {
  /** Defaults to '/' — matches the path removeStorageItem() already assumes for deletes. */
  path?: string
  /** ISO date string. Omit for a session cookie (cleared when the browser closes). */
  expires?: string
}

/**
 * Write (create or overwrite) a cookie via `document.cookie`: the full surface
 * JS can control (name, value, path, expiry). HttpOnly is deliberately not
 * exposed — script can neither set it nor read it back, so every entry
 * `readStorage()` surfaces is one JS already fully manages.
 */
export function setCookie(key: string, value: string, options: SetCookieOptions = {}): void {
  if (!isBrowser()) return
  if (!key) return
  try {
    const path = options.path?.trim() || '/'
    let cookieStr = `${encodeURIComponent(key)}=${value}; path=${path}`
    if (options.expires) {
      const d = new Date(options.expires)
      if (!Number.isNaN(d.getTime())) cookieStr += `; expires=${d.toUTCString()}`
    }
    document.cookie = cookieStr
  } catch {
    // no-op: Storage may be read-only
  }
}

/** Remove a single item from the given storage area. */
export function removeStorageItem(area: StorageArea, key: string): void {
  if (!isBrowser()) return
  try {
    if (area === 'local') {
      localStorage.removeItem(key)
    } else if (area === 'session') {
      sessionStorage.removeItem(key)
    } else if (area === 'cookies') {
      document.cookie = `${encodeURIComponent(key)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  } catch {
    // no-op: Storage may be read-only
  }
}

/** Clear all items in the given storage area (excluding hakka: prefixed ones). */
export function clearStorageArea(area: StorageArea): void {
  if (!isBrowser()) return
  try {
    if (area === 'local') {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && !key.startsWith('hakka:')) keysToRemove.push(key)
      }
      for (const key of keysToRemove) localStorage.removeItem(key)
    } else if (area === 'session') {
      const keysToRemove: string[] = []
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)
        if (key && !key.startsWith('hakka:')) keysToRemove.push(key)
      }
      for (const key of keysToRemove) sessionStorage.removeItem(key)
    } else if (area === 'cookies') {
      const cookies = readCookies()
      for (const { key } of cookies) {
        document.cookie = `${encodeURIComponent(key)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      }
    }
  } catch {
    // no-op
  }
}
