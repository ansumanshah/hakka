/** Shared synchronous trace-ID derivation for browser and Node correlation. */

/** W3C trace-context header name. See https://www.w3.org/TR/trace-context/ */
export const TRACEPARENT_HEADER = 'traceparent'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX32_RE = /^[0-9a-f]{32}$/i

// Synchronous SHA-256 fallback: Web Crypto is async and Node builtins cannot
// enter the browser bundle. UUID and hex IDs bypass hashing.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

let traceIdEncoder: TextEncoder | undefined
// Signed 32-bit arithmetic avoids unsigned-number widening in the hash loop.
// Each synchronous block overwrites the shared schedule before reading it.
const hashSchedule = new Int32Array(64)
const singleBlock = new Uint8Array(64)
const singleBlockView = new DataView(singleBlock.buffer)

/** First 128 bits of the synchronous SHA-256 digest of a UTF-8 string, as lowercase hex. */
function sha256TraceId(message: string): string {
  const msgBytes = (traceIdEncoder ??= new TextEncoder()).encode(message)
  const bitLen = msgBytes.length * 8

  // Pad: 0x80, then zero bytes until length ≡ 56 (mod 64), then 8-byte
  // big-endian bit length.
  const paddedLen = Math.ceil((msgBytes.length + 9) / 64) * 64
  const padded = paddedLen === 64 ? singleBlock : new Uint8Array(paddedLen)
  if (paddedLen === 64) padded.fill(0)
  padded.set(msgBytes)
  padded[msgBytes.length] = 0x80
  // bitLen fits in 32 bits for any realistic correlationId; high word is 0.
  const view = paddedLen === 64 ? singleBlockView : new DataView(padded.buffer)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const w = hashSchedule
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + K[i] + w[i]) | 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
    h5 = (h5 + f) | 0
    h6 = (h6 + g) | 0
    h7 = (h7 + h) | 0
  }

  return (
    (h0 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h3 >>> 0).toString(16).padStart(8, '0')
  )
}

/** Synchronous random hex string of `byteLen` bytes — Web Crypto when available, `Math.random` fallback. */
function randomHex(byteLen: number): string {
  const bytes = new Uint8Array(byteLen)
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < byteLen; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

// Caches the derived trace-id per correlationId so a fan-out to N upstream
// calls doesn't hash the same id N times. Capped and cleared wholesale (not
// LRU) since correlationIds churn per-request anyway — worst case is a burst
// of cache misses right after a clear, never incorrectness.
const TRACE_ID_CACHE_LIMIT = 512
const traceIdCache = new Map<string, string>()

/**
 * Derive a stable 32-hex trace-id segment for a Hakka correlationId — same
 * logical id always maps to the same trace-id, across hops and across
 * browser/Node. A UUID has its dashes stripped; a 32-hex id passes through
 * unchanged; anything else is sha256-hashed and truncated. Memoized.
 */
export function deriveTraceId(correlationId: string): string {
  const cached = traceIdCache.get(correlationId)
  if (cached !== undefined) return cached

  let traceId: string
  if (HEX32_RE.test(correlationId)) traceId = correlationId.toLowerCase()
  else if (UUID_RE.test(correlationId)) traceId = correlationId.replace(/-/g, '').toLowerCase()
  else traceId = sha256TraceId(correlationId)

  if (traceIdCache.size >= TRACE_ID_CACHE_LIMIT) traceIdCache.clear()
  traceIdCache.set(correlationId, traceId)
  return traceId
}

/**
 * Build a valid `traceparent` header value for `correlationId`. A fresh
 * 16-hex span id is generated per call (each hop gets its own span), the
 * trace-id segment is deterministic per correlationId (see `deriveTraceId`),
 * version `00`, flags `01` (sampled).
 */
export function buildTraceparent(correlationId: string): string {
  const traceId = deriveTraceId(correlationId)
  const spanId = randomHex(8)
  return `00-${traceId}-${spanId}-01`
}
