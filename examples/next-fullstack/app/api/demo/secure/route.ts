import { NextResponse } from 'next/server'

/**
 * Reports whether it saw an `Authorization` header on the way in. The client
 * card sends a fake bearer token; `authorization` is in hakka-core's default
 * redaction list (`utils/headerRedaction.ts`), so the captured record shows
 * `[REDACTED]` instead of the token. This is the only route in the example
 * that gives that default something real to redact.
 *
 * It deliberately does not set a cookie. See `SecureCard.tsx` for why a browser
 * fetch() capture can never populate the inspector's Cookies tab.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  return NextResponse.json({ authorizationSeen: Boolean(authHeader) })
}
