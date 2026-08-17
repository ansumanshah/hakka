// Mock for react-native in test environment
const Share = {
  share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissedAction',
}

const Platform = {
  OS: 'ios',
  select: jest.fn((obj) => obj.ios || obj.default),
}

const NativeEventEmitter = jest.fn().mockImplementation(() => ({
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  removeAllListeners: jest.fn(),
}))

const TurboModuleRegistry = {
  get: jest.fn(() => null),
}

const NativeModules = {}

const Clipboard = {
  setString: jest.fn(),
  getString: jest.fn().mockResolvedValue(''),
}

const Alert = {
  alert: jest.fn(),
}

const Dimensions = {
  get: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}

const PixelRatio = {
  get: jest.fn(() => 3),
  roundToNearestPixel: jest.fn((px) => Math.round(px)),
}

module.exports = {
  Share,
  Platform,
  NativeEventEmitter,
  TurboModuleRegistry,
  NativeModules,
  Clipboard,
  Alert,
  Dimensions,
  PixelRatio,
  StyleSheet: {
    create: (styles) => styles,
    flatten: (style) => style,
  },
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  Modal: 'Modal',
  Animated: {
    Value: jest.fn(() => ({
      interpolate: jest.fn(),
      setValue: jest.fn(),
    })),
    timing: jest.fn(),
    spring: jest.fn(),
    sequence: jest.fn(),
    parallel: jest.fn(),
    View: 'Animated.View',
  },
}
