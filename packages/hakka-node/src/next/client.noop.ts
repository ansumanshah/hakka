/**
 * hakka-node/next/client, production build. Bundlers resolve this file through
 * the `production` export condition, so a production bundle carries none of
 * the overlay loader: the dynamic `import('hakka-browser')` in `client.ts` is
 * never reachable and no overlay chunk is emitted.
 */
export type { ClientCaptureOptions } from './client'

export function startClientCapture(): void {}
