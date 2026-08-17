/**
 * Pure row-severity resolver for Row.tsx — kept JSX-free so it's directly
 * unit-testable (mirrors statusColors.ts's split of color logic out of Badge.tsx).
 *
 * An error/4xx/5xx row gets BOTH the 2px left-edge stripe AND a subtle
 * error-tinted background (~8% alpha), matching iOS's RequestRowView (chili
 * @ 8%, not Android's stripe-only treatment). A non-nil `error` always wins
 * over status; the background is one binary "something's off" signal shared
 * by 4xx/5xx alike, while the stripe keeps the sharper chili (5xx/error) vs.
 * turmeric (4xx) distinction.
 */
import type { NetworkRequest } from 'hakka-core'

import type { Theme } from '../styles/createStyleSheet'

export interface RowSeverity {
  /** Left-edge stripe color — 'transparent' when the row is neither selected nor erroring. */
  stripeColor: string
  /** Row background tint, or `undefined` when the row should use its default (untinted) background. */
  rowBackground: string | undefined
}

export function getRowSeverity(
  request: Pick<NetworkRequest, 'error' | 'status'>,
  selected: boolean,
  colors: Theme['colors'],
): RowSeverity {
  const isServerError = !!request.error || (request.status != null && request.status >= 500)
  const isClientError = !isServerError && request.status != null && request.status >= 400

  const stripeColor = selected
    ? colors.accent
    : isServerError
      ? colors.chili
      : isClientError
        ? colors.turmeric
        : 'transparent'

  const isErrorSeverity = request.error != null || (request.status != null && request.status >= 400)
  const rowBackground = selected ? colors.accent + '17' : isErrorSeverity ? colors.chili + '14' : undefined

  return { stripeColor, rowBackground }
}

// Metro, emulator loopback aliases, and LAN dev servers are all plain http
// during development — painting every host chili-red turns "not encrypted"
// into noise on an otherwise healthy list. Keep the signal for a real remote
// http origin; drop it for loopback.
const LOOPBACK_HOSTNAME = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.0\.2\.2|10\.0\.3\.2)$/i

function isLoopbackHost(host: string): boolean {
  // An IPv6 literal keeps colons of its own, so its port lives after the `]`.
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '')
  return LOOPBACK_HOSTNAME.test(hostname)
}

/** Host text color: chili only for an insecure, non-loopback origin. */
export function hostColor(host: string, isSecure: boolean, colors: Theme['colors']): string {
  return isSecure || isLoopbackHost(host) ? colors.textSubtle : colors.chili
}
