import type { RozeniteConfig } from '@rozenite/vite-plugin'

/**
 * Rozenite plugin manifest — read by `@rozenite/vite-plugin` during build and
 * development, and at runtime by the host app's Metro/Re.Pack config via
 * `@rozenite/metro`/`@rozenite/repack`'s plugin auto-discovery.
 */
export default {
  integrations: ['react-native'],
  panels: [
    {
      name: 'Hakka',
      source: './src/ui/App.tsx',
    },
  ],
  dev: {
    // The v2 dev host receives the panel's snapshot request and answers with
    // one representative record, matching the production device-side flow.
    flows: [
      {
        name: 'Request snapshot',
        autoRun: true,
        async run({ send, getMessages, waitForMessage }) {
          const snapshotRequest = { type: 'get-snapshot', direction: 'out' } as const

          // The panel can request its snapshot before this auto-run starts.
          if (getMessages(snapshotRequest).length === 0) {
            await waitForMessage(snapshotRequest)
          }
          const endTime = Date.now()
          send('request', {
            id: 'dev-flow-1',
            url: 'https://api.example.com/v1/dev-flow-check',
            method: 'GET',
            status: 200,
            startTime: endTime - 100,
            endTime,
            duration: 100,
            size: 256,
            contentType: 'application/json',
          })
        },
      },
    ],
  },
} satisfies RozeniteConfig
