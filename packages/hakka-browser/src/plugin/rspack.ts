/**
 * `hakka-browser/rspack` — drop the Hakka inspector into an Rspack app. Requires
 * `html-webpack-plugin` (Rspack supports it), whose output the overlay
 * `<script>` is injected into.
 *
 *   // rspack.config.js
 *   const hakka = require('hakka-browser/rspack').default
 *   module.exports = { plugins: [hakka()] }
 */
import { unplugin } from './factory'

export type { HakkaPluginOptions } from './inject'

export const hakka = unplugin.rspack
export default hakka
