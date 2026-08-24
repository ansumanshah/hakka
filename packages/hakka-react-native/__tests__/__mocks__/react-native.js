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

// Minimal DeviceEventEmitter stand-in — real RN backs this with its own native
// event system; tests drive it directly via `emit()` to simulate a native
// 'shake' event (or any other device event) without a real device.
const DeviceEventEmitter = {
  _listeners: {},
  addListener(eventName, handler) {
    if (!this._listeners[eventName]) this._listeners[eventName] = new Set()
    this._listeners[eventName].add(handler)
    return { remove: () => this._listeners[eventName]?.delete(handler) }
  },
  emit(eventName, ...args) {
    this._listeners[eventName]?.forEach((handler) => handler(...args))
  },
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
  DeviceEventEmitter,
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
