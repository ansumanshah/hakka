const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')
// Makes Hakka's optional peer deps genuinely optional. This app installs none
// of them (no gesture-handler/reanimated/mmkv/async-storage/etc.), so without
// this wrapper Metro fails to resolve those modules at bundle time, before
// the try/catch guards around them ever run. See
// packages/hakka-react-native/metro.js.
const { withHakka } = require('hakka-react-native/metro')

// Same monorepo layout as ../react-native-example: bun hoists shared deps to
// the workspace root, so Metro needs to watch and resolve from there too.
const workspaceRoot = path.resolve(__dirname, '../..')

const config = getDefaultConfig(__dirname)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = withHakka(config)
