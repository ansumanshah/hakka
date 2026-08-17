// Mock for createHakka to avoid native module loading in tests
const capturedLogs = []

const Hakka = {
  addLog: jest.fn((log) => capturedLogs.push(log)),
  getLogs: jest.fn(() => [...capturedLogs]),
  clearLogs: jest.fn(() => (capturedLogs.length = 0)),
  getLogCount: jest.fn(() => capturedLogs.length),
  isReady: jest.fn(() => false),
  init: jest.fn(),
  exportJson: jest.fn(),
  exportHar: jest.fn(),
  exportCurl: jest.fn(),
  getPerformanceMetrics: jest.fn(),
  setSensitiveHeaders: jest.fn(),
  sanitizeLogs: jest.fn(),
  setIgnoredHosts: jest.fn(),
  setIgnoredPatterns: jest.fn(),
  simulateSlowNetwork: jest.fn(),
  blockRequests: jest.fn(),
  unblockRequests: jest.fn(),
  enableInterceptors: jest.fn(),
  disableInterceptors: jest.fn(),
  getInterceptorStatus: jest.fn(),
  setOnNewRequestListener: jest.fn(),
  subscribe: jest.fn(),
  onLog: jest.fn(),
  hybrid: {
    subscribe: jest.fn(),
    onLog: jest.fn(),
  },
  _capturedLogs: capturedLogs, // for test inspection
  _reset: () => {
    capturedLogs.length = 0
    jest.clearAllMocks()
    Hakka.addLog = jest.fn((log) => capturedLogs.push(log))
    Hakka.getLogs = jest.fn(() => [...capturedLogs])
  },
}

module.exports = { Hakka }
