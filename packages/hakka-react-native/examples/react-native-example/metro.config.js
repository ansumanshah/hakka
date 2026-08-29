const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('node:path')
// Makes Hakka's optional peer deps genuinely optional. This app installs none
// of them, so without this wrapper Metro fails to resolve `react-native-mmkv`
// (and seven siblings) at bundle time, before the try/catch guards around them
// ever run. See packages/hakka-react-native/metro.js.
const { withHakka } = require('hakka-react-native/metro')

const workspaceRoot = path.resolve(__dirname, '../../../..')

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  projectRoot: __dirname,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')],
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
    unstable_enableSymlinks: true,
  },
}

module.exports = withHakka(mergeConfig(getDefaultConfig(__dirname), config))
