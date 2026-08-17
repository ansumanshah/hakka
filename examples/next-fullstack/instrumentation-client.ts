/**
 * Next.js client-boot hook (Next 15.3+). One line starts the Hakka overlay and
 * connects it to the bridge, so the browser inspector shows server + client
 * requests in one UI. Dev-only and browser-only.
 *
 * On older Next, drop `<HakkaOverlay/>` into your root layout instead (a tiny
 * client component that calls `startHakkaClient()` from `hakka-node/next/client`).
 */
import 'hakka-node/next/client'
