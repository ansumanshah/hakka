import hakka from 'hakka-browser/vite'
import { defineConfig } from 'vite'

// The only line this example adds over a stock Vite config. No `Hakka.start()`
// call anywhere in `src/` — the plugin injects it into index.html itself, only
// during `vite dev`/`vite serve`. See README.md for what `hakka()` does and
// the dev-only guarantee.
export default defineConfig({
  plugins: [
    hakka({
      start: {
        overlay: true,
      },
    }),
  ],
})
