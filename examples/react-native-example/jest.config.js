// RN 0.85+ publishes its Jest integration from this scoped preset. Keep the
// example on Jest 29, matching the preset's own transformer/runtime family.
module.exports = {
  preset: '@react-native/jest-preset',
  modulePaths: ['<rootDir>/node_modules'],
  // Bun stores packages behind node_modules/.bun symlinks. Match the scoped
  // React Native packages through that physical path so the preset's ESM and
  // Flow-typed setup files still pass through babel-jest.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|\\.bun/[^/]+/node_modules/((jest-)?react-native|@react-native(-community)?)))/',
  ],
}
