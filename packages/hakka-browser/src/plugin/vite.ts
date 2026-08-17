/**
 * `hakka-browser/vite` — drop the Hakka inspector into any Vite app with zero app
 * code. Add the plugin; the overlay auto-injects during `vite serve`.
 *
 *   // vite.config.ts
 *   import hakka from 'hakka-browser/vite'
 *   export default defineConfig({ plugins: [hakka()] })
 */
import { unplugin } from './factory'

export type { HakkaPluginOptions } from './inject'

export const hakka = unplugin.vite
export default hakka
