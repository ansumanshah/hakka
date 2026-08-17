module.exports = (api) => {
  // Use simpler babel config for tests, react-native preset for bundling
  if (api.env('test')) {
    return {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
      ],
    }
  }
  return {
    presets: ['module:@react-native/babel-preset'],
  }
}
