/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: './babel.config.js' }],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.[jt]s?(x)', '<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Mock React Native modules that aren't available in node environment
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.js',
    '^react-native-mmkv$': '<rootDir>/__tests__/__mocks__/react-native-mmkv.js',
    // Mock createHakka to avoid TurboModule loading
    '.*/createHakka$': '<rootDir>/__tests__/__mocks__/createHakka.js',
    '.*/NativeHakkaMonitor$': '<rootDir>/__tests__/__mocks__/NativeHakkaMonitor.js',
    // Mock @react-native-clipboard/clipboard to avoid TurboModule loading
    '^@react-native-clipboard/clipboard$': '<rootDir>/__tests__/__mocks__/clipboard.js',
    '^hakka-core$': '<rootDir>/../hakka-core/src/index.ts',
  },
  // Setup globals used in RN source (__DEV__)
  globals: {
    __DEV__: true,
  },
  // Collect coverage from source files
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
}
