import { resolve } from 'node:path'

import { defineConfig } from 'vite'

import { installDemoApi } from './server/demoApi.ts'

// Fixed, unusual port — this example runs alongside other hakka-browser
// examples during local dev/CI and shouldn't fight any of them for 5173.
const PORT = 5195

export default defineConfig({
  server: { port: PORT },
  preview: { port: PORT },
  build: {
    // Two independent panels, two HTML entries — the same page composed
    // twice, once from raw custom elements (index.html) and once from
    // hakka-browser/react's wrappers (react.html). See README.md.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        react: resolve(import.meta.dirname, 'react.html'),
      },
    },
  },
  plugins: [
    {
      name: 'build-your-own-devtools-demo-api',
      configureServer(server) {
        installDemoApi(server.middlewares)
      },
      configurePreviewServer(server) {
        installDemoApi(server.middlewares)
      },
    },
  ],
})
