/**
 * @format
 */

import React from 'react'
import ReactTestRenderer from 'react-test-renderer'

jest.mock('hakka-react-native', () => ({
  Hakka: {
    clear: jest.fn(),
    getLogCount: jest.fn(() => 0),
    isActive: true,
    pause: jest.fn(),
    resume: jest.fn(),
    show: jest.fn(),
    start: jest.fn(),
  },
  ThrottleEngine: { setProfile: jest.fn() },
  enableJsCapture: jest.fn(),
  enableNativeCapture: jest.fn(),
  mockEngine: { clear: jest.fn() },
  useNetworkLogs: () => ({ logs: [], totalCount: 0 }),
}))

jest.mock('hakka-react-native/ui', () => ({
  HakkaInspector: {
    Wrapper: ({ children }: { children: unknown }) => children,
  },
}))

jest.mock('hakka-rozenite', () => ({
  useHakkaRozeniteDevTools: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}))

jest.mock('../WebViewCaptureScreen', () => ({
  WebViewCaptureScreen: () => null,
}))

jest.mock('../WrapperModesScreen', () => ({
  WrapperModesScreen: () => null,
}))

import App from '../App'

test('sends the demo GET request from the migrated app', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response)
  let renderer: ReactTestRenderer.ReactTestRenderer

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />)
  })

  const getButton = renderer!.root.findByProps({ testID: 'demo-request-GET' })
  await ReactTestRenderer.act(async () => getButton.props.onPress())

  expect(fetchSpy).toHaveBeenCalledWith('https://httpbin.org/get', undefined)

  fetchSpy.mockRestore()
  await ReactTestRenderer.act(async () => renderer!.unmount())
})
