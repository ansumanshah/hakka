// Mock for @react-native-clipboard/clipboard — the real package reaches into
// TurboModuleRegistry.getEnforcing() at import time, which our minimal
// react-native mock doesn't provide.
module.exports = {
  default: {
    setString: jest.fn(),
    getString: jest.fn().mockResolvedValue(''),
  },
}
