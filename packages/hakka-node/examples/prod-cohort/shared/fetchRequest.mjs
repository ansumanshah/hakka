/**
 * node:http <-> Fetch Request/Response bridge.
 *
 * `createPullHandler`'s contract is framework-agnostic:
 * `(request: Request) => Promise<Response>`, the exact shape a Next.js
 * route handler (`export const GET = createPullHandler(...)`) exports
 * directly, no adapter needed. This demo app has no framework, deliberately
 * (it's the same claim `hakka-node`'s root README opens with, proven again
 * for the prod entry), so this file does by hand what Next/Hono/Express
 * would do for you: turn an `IncomingMessage` into a standard `Request`, and
 * write a standard `Response` back out over `ServerResponse`. Node's global
 * `Request`/`Response`/`Headers` (undici) make this a dozen lines, not a
 * dependency.
 */
export function toFetchRequest(req) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else headers.set(key, value)
  }
  const url = `http://${req.headers.host ?? '127.0.0.1'}${req.url}`
  return new Request(url, { method: req.method, headers })
}

export async function sendFetchResponse(fetchRes, res) {
  const body = await fetchRes.text()
  res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
  res.end(body)
}
