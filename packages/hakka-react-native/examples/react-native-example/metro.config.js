const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')
const path = require('node:path')

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

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
