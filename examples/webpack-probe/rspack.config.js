import hakka from 'hakka-browser/rspack'
import HtmlWebpackPlugin from 'html-webpack-plugin'

/** @type {import('@rspack/core').Configuration} */
export default {
  mode: 'development',
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    clean: true,
  },
  module: {
    rules: [{ test: /rspack-probe\.txt$/, type: 'asset/resource', generator: { filename: 'rspack-probe.txt' } }],
  },
  plugins: [new HtmlWebpackPlugin({ title: 'hakka rspack probe' }), hakka({ start: { overlay: true } })],
}
