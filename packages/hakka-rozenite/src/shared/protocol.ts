import type { NetworkRequest } from 'hakka-core'

/** Must match this package's `name` in package.json exactly — the RN-side hook
 * and the DevTools panel both construct `useRozeniteDevToolsClient` with this
 * string, and a mismatch means neither side's handlers ever run. */
export const HAKKA_ROZENITE_PLUGIN_ID = 'hakka-rozenite'

/**
 * Shared by the RN-side bridge (`react-native/bridge.ts`) and the DevTools
 * panel (`ui/App.tsx`) as `useRozeniteDevToolsClient<HakkaRozeniteEventMap>`'s
 * generic. Must stay a plain object type, not an `interface` —
 * `useRozeniteDevToolsClient`'s generic requires `Record<string, unknown>`,
 * which a named `interface` doesn't structurally satisfy without its own
 * index signature.
 */
export type HakkaRozeniteEventMap = {
  /** RN -> panel. One captured/updated request, same payload shape as
   * `hakka-react-native`'s desktop-bridge frame. Sent on the initial backlog
   * flush and again on every `Hakka.onRequest` fire; the panel-side store
   * upserts by `id`, so a later frame for the same id replaces the earlier
   * one instead of duplicating it. */
  request: NetworkRequest

  /** panel -> RN. "Resend everything you currently have" — sent on panel
   * mount and resendable any time the panel needs to resync. */
  'get-snapshot': Record<string, never>

  /** panel -> RN. Clears the underlying `Hakka` log store itself, not just
   * the panel's local mirror. */
  clear: Record<string, never>

  /** RN -> panel. Acks a `clear` message once `Hakka.clearLogs()` has run. */
  cleared: Record<string, never>
}
