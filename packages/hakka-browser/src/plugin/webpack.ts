/**
 * `hakka-browser/webpack` — drop the Hakka inspector into a webpack app. Requires
 * `html-webpack-plugin` (the overlay `<script>` is injected into its output).
 *
 *   // webpack.config.js
 *   const hakka = require('hakka-browser/webpack').default
 *   module.exports = { plugins: [hakka()] }
 */
import { unplugin } from './factory'

export type { HakkaPluginOptions } from './inject'

export const hakka = unplugin.webpack
export default hakka
