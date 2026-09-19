import { rozenitePlugin } from '@rozenite/vite-plugin'
import { defineConfig } from 'vite'

/** Drives the panel build and development host. `rozenitePlugin()` reads
 * `rozenite.config.ts` to discover the panel and generate its manifest. */
export default defineConfig({
  root: __dirname,
  plugins: rozenitePlugin(),
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
