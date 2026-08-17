import { rozenitePlugin } from '@rozenite/vite-plugin'
import { defineConfig } from 'vite'

/** Drives `rozenite build`/`rozenite dev` (panel + react-native.ts entry
 * bundling) — `rozenitePlugin()` reads `rozenite.config.ts`'s panel list and
 * the `VITE_ROZENITE_TARGET` env var to decide what to bundle. */
export default defineConfig({
  root: __dirname,
  plugins: [rozenitePlugin()],
  base: './',
  build: {
    outDir: './dist',
    emptyOutDir: false,
    reportCompressedSize: false,
    minify: true,
    // Off on purpose: this package and hakka-browser were 6.2 MB of the repo's
    // 7 MB of published .map files (hakka-core/hakka-node/hakka keep theirs).
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
})
