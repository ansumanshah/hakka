/**
 * @format
 */

import { Hakka } from 'hakka-react-native'
import React from 'react'
import { Alert } from 'react-native'
import ReactTestRenderer from 'react-test-renderer'

jest.mock('hakka-react-native', () => ({
  Hakka: {
    clear: jest.fn(),
    getLogCount: jest.fn(() => 0),
    isActive: true,
    pause: jest.fn(),
    resume: jest.fn(),
    show: jest.fn().mockResolvedValue(true),
    hide: jest.fn(),
    start: jest.fn(),
  },
  ThrottleEngine: { setProfile: jest.fn() },
  enableJsCapture: jest.fn(),
  enableNativeCapture: jest.fn(),
  mockEngine: { clear: jest.fn() },
  useNetworkLogs: () => ({ logs: [], totalCount: 0 }),
}))

jest.mock('hakka-rozenite', () => ({
  useHakkaRozeniteDevTools: jest.fn(),
}))

jest.mock('../WebViewCaptureScreen', () => ({
  WebViewCaptureScreen: () => null,
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

test('opens native modes, reports presentation failure, and dismisses the inspector', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  let renderer!: ReactTestRenderer.ReactTestRenderer
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />)
  })
  await ReactTestRenderer.act(async () => renderer.root.findByProps({ testID: 'demo-group-Tools' }).props.onPress())
  await ReactTestRenderer.act(async () => renderer.root.findByProps({ testID: 'demo-request-Sheet' }).props.onPress())
  expect(Hakka.show).toHaveBeenLastCalledWith({ as: 'sheet' })
  jest.mocked(Hakka.show).mockResolvedValueOnce(false)
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'demo-request-Fullscreen' }).props.onPress(),
  )
  expect(alert).toHaveBeenCalledWith('Native UI unavailable', expect.any(String))
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'demo-request-Hide inspector' }).props.onPress(),
  )
  expect(Hakka.hide).toHaveBeenCalled()
  await ReactTestRenderer.act(async () => renderer.unmount())
  alert.mockRestore()
})
