/**
 * Rozenite plugin manifest — read by `rozenite build`/`rozenite dev`, and at
 * runtime by the host app's Metro/Re.Pack config via
 * `@rozenite/metro`/`@rozenite/repack`'s plugin auto-discovery.
 */
export default {
  panels: [
    {
      name: 'Hakka',
      source: './src/ui/App.tsx',
    },
  ],
  dev: {
    // Fires once the panel iframe loads in `rozenite dev`'s in-browser host —
    // asks the (fake, dev-host) React Native side to resend its backlog, the
    // same message the real panel sends from `App.tsx`'s mount effect. Lets
    // you iterate on the panel's rendering without a real device attached.
    flows: [
      {
        name: 'Request snapshot',
        autoRun: true,
        async run({ send }: { send: (type: string, payload: unknown) => void }) {
          send('get-snapshot', {})
        },
      },
    ],
  },
}
