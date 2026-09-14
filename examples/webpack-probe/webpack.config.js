import hakka from 'hakka-browser/webpack'
import HtmlWebpackPlugin from 'html-webpack-plugin'

/** @type {import('webpack').Configuration} */
export default {
  mode: 'development',
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({ title: 'hakka webpack probe' }), hakka({ start: { overlay: true } })],
}
