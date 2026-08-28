'use client'

import { DemoCard } from './DemoCard'
import { RunButton } from './RunButton'

/**
 * Sends a fake `Authorization` header so the default redaction list has something
 * real to hide. The captured record shows `authorization: [REDACTED]` under
 * Detail > Request.
 *
 * Deliberately NOT a Cookies-tab demo. Two independent reasons stop a browser
 * fetch() capture from ever populating that tab, and both are worth knowing:
 *   1. `Set-Cookie` is a forbidden response header per the Fetch spec, so
 *      `Response.headers` never exposes it to JS and the interceptor cannot see
 *      it. The outgoing `Cookie` header is attached by the browser at the wire
 *      level, equally invisible to fetch() interception.
 *   2. Even if both were visible, `cookie` and `set-cookie` are in hakka-core's
 *      default redaction list (`utils/headerRedaction.ts`), so the value would
 *      arrive as the literal string `[REDACTED]`, which `parseSetCookie` parses
 *      to zero entries. `Detail.tsx`'s `hasCookies()` memo gates the tab on a
 *      non-empty parse, so it still would not render.
 */
export function SecureCard() {
  return (
    <DemoCard
      method="GET"
      path="/api/demo/secure"
      title="Redacted headers"
      description="Sends an Authorization header. Open Detail > Request: the value is [REDACTED], never the token."
    >
      <RunButton
        testId="secure-call"
        idleLabel="Call secure route"
        pendingLabel="Calling…"
        run={async () => {
          const res = await fetch('/api/demo/secure', {
            headers: { authorization: 'Bearer demo-not-a-real-token' },
          })
          const data = (await res.json()) as { authorizationSeen?: boolean }
          return {
            ok: res.ok,
            status: res.status,
            note: data.authorizationSeen ? 'server saw the token, inspector shows [REDACTED]' : 'no auth header',
          }
        }}
      />
    </DemoCard>
  )
}
