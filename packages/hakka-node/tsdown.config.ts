import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    prod: 'src/prod.ts',
    'next/index': 'src/next/index.ts',
    'next/server': 'src/next/server.ts',
    'next/client': 'src/next/client.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  clean: true,
  // hakka-browser stays external so hakka-node/next/client's dynamic `import('hakka-browser')`
  // reaches the CONSUMER's bundler as a real import specifier, not an inlined
  // dependency — that's what keeps the browser-side chunk from pulling in
  // hakka-browser (and its own deps) unless the app actually installs it.
  deps: { neverBundle: ['hakka-core', 'hakka-bridge', 'ws', 'hakka-browser'] },
})
