// Mock for react-native-mmkv in test environment
const store = new Map()

const MMKV = jest.fn().mockImplementation(() => ({
  set: jest.fn((key, value) => store.set(key, value)),
  getString: jest.fn((key) => store.get(key)),
  getBoolean: jest.fn((key) => store.get(key)),
  getNumber: jest.fn((key) => store.get(key)),
  delete: jest.fn((key) => store.delete(key)),
  contains: jest.fn((key) => store.has(key)),
  clearAll: jest.fn(() => store.clear()),
  getAllKeys: jest.fn(() => Array.from(store.keys())),
}))

module.exports = { MMKV }
