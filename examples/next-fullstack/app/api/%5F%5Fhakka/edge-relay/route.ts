import { createEdgeRelayHandler } from 'hakka-node/next/server'

/**
 * Receives the records `hakka-node/next` relays from the Edge runtime, which
 * has no embedded bridge, and hands them to the hub the server capture streams
 * into. The folder is `%5F%5Fhakka` because Next treats `_`-prefixed folders as
 * private. It answers 404 in production.
 */
export const POST = createEdgeRelayHandler({ bridgeUrl: process.env.HAKKA_BRIDGE_URL })
