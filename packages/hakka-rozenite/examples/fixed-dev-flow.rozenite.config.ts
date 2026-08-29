/**
 * Reference only — not wired into the build. `rozenite build`/`rozenite dev`
 * read `../rozenite.config.ts`, not this file.
 *
 * A drop-in replacement for that file's `dev.flows` entry, tested live on
 * 2026-08-29 (see `README.md` in this directory for the full trace). The
 * shipped flow only calls `send('get-snapshot', {})`, which does nothing —
 * see the two root causes documented in `README.md` and in the package
 * README's "Verification status" section. This version fixes both:
 *
 * 1. Listens for the panel's own outbound `get-snapshot` instead of sending
 *    one — `get-snapshot` is `panel -> RN` only (`../src/shared/protocol.ts`),
 *    and the panel has no inbound handler for it.
 * 2. Stays pending on `signal` instead of returning immediately after
 *    registering the listener — `@rozenite/vite-plugin`'s dev-host tears
 *    down every listener a flow registered the instant that flow's own
 *    `run()` promise resolves, so a fire-and-forget `onMessage()` call is
 *    removed before it can ever fire.
 *
 * To apply: paste this file's `dev` block over the one in
 * `../rozenite.config.ts`.
 */
export default {
  panels: [
    {
      name: 'Hakka',
      source: './src/ui/App.tsx',
    },
  ],
  dev: {
    // Fires once the panel iframe loads in `rozenite dev`'s in-browser host.
    // Listens for the panel's own `get-snapshot` (sent from `panelStore.ts`
    // on mount) and answers it with one fake request, the same way the real
    // RN-side bridge (`react-native/bridge.ts`'s `flushBacklog`) would answer
    // it with `Hakka.getLogs()`. Lets you iterate on the panel's rendering
    // without a real device attached — verified: the panel auto-populates
    // this fake row the instant it loads, no manual dispatch needed.
    flows: [
      {
        name: 'Request snapshot',
        autoRun: true,
        async run({
          send,
          onMessage,
          signal,
        }: {
          send: (type: string, payload: unknown) => void
          onMessage: (type: string, cb: (payload: unknown) => void) => { remove(): void }
          signal: AbortSignal
        }) {
          onMessage('get-snapshot', () => {
            send('request', {
              id: 'dev-flow-1',
              url: 'https://api.example.com/v1/dev-flow-check',
              method: 'GET',
              status: 200,
              startTime: Date.now() - 100,
              endTime: Date.now(),
              duration: 100,
              size: 256,
              contentType: 'application/json',
            })
          })
          // Keep the flow alive — see root cause (2) above. Resolves once
          // the dev-host aborts this run (page reload, flow stopped).
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
      },
    ],
  },
}
