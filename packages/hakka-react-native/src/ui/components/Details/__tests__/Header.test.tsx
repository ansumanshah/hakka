/**
 * Header — "Copy as" export menu.
 *
 * Covers the MSW-handler wiring added alongside web's Detail.tsx equivalent:
 * the Header's "Export request" → "Copy as…" Alert chain must offer an "MSW
 * handler" option that round-trips through `buildMswHandlers` (core
 * interop/msw.ts), same as it already does for cURL/fetch/axios/HTTPie/Python.
 *
 * No prior component-render test exists for this package's UI layer (jest
 * `testEnvironment: 'node'`, no jsdom) — this uses `react-test-renderer`
 * directly. `ReplayEditor` is mocked out: it pulls in `@shopify/flash-list`,
 * an unrelated native list dependency that would otherwise need its own
 * mocking for a test that has nothing to do with the replay-editing modal.
 */
import type { NetworkRequest } from 'hakka-core'
import React from 'react'
import { Alert, Share } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'

import { Header } from '../Header'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

jest.mock('../ReplayEditor', () => ({
  ReplayEditor: () => null,
}))

// The icon barrel pulls in `react-native-svg`, which reaches into RN internals
// (`Touchable`) our minimal `react-native` test mock doesn't provide. Icons are
// purely decorative for this test — stub them out rather than deep-mock svg.
jest.mock('../../../icons', () => {
  const stub = () => null
  return { ArrowLeft: stub, Check: stub, Download: stub, RotateCcw: stub, X: stub }
})

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    requestHeaders: { accept: 'application/json' },
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    responseBodySize: 10,
    ...overrides,
  }
}

interface AlertButton {
  text?: string
  onPress?: () => void
  style?: string
}

function pressExport(root: TestRenderer.ReactTestRenderer): void {
  const exportBtn = root.root.findByProps({ testID: 'hakka-export-request' })
  act(() => {
    exportBtn.props.onPress()
  })
}

describe('Header — Export / Copy as menu', () => {
  beforeEach(() => {
    ;(Alert.alert as jest.Mock).mockClear()
    ;(Share.share as jest.Mock).mockClear()
  })

  it('offers "Copy as…" from the Export menu, which lists an MSW handler option', () => {
    const request = makeRequest()
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Header url={request.url} onClose={() => {}} request={request} />)
    })

    pressExport(root)

    expect(Alert.alert).toHaveBeenCalledTimes(1)
    const [, , exportButtons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, AlertButton[]]
    const copyAs = exportButtons.find((b) => /copy as/i.test(b.text ?? ''))
    expect(copyAs).toBeTruthy()

    act(() => {
      copyAs!.onPress!()
    })

    expect(Alert.alert).toHaveBeenCalledTimes(2)
    const [, , copyButtons] = (Alert.alert as jest.Mock).mock.calls[1] as [string, string, AlertButton[]]
    const buttonTexts = copyButtons.map((b) => b.text)
    expect(buttonTexts).toEqual(
      expect.arrayContaining(['cURL', 'fetch()', 'axios', 'HTTPie', 'Python (requests)', 'MSW handler', 'Cancel']),
    )
  })

  it('MSW handler option shares a buildMswHandlers-shaped snippet for the selected request', () => {
    const request = makeRequest()
    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(<Header url={request.url} onClose={() => {}} request={request} />)
    })

    pressExport(root)
    const [, , exportButtons] = (Alert.alert as jest.Mock).mock.calls[0] as [string, string, AlertButton[]]
    act(() => {
      exportButtons.find((b) => /copy as/i.test(b.text ?? ''))!.onPress!()
    })

    const [, , copyButtons] = (Alert.alert as jest.Mock).mock.calls[1] as [string, string, AlertButton[]]
    const mswOption = copyButtons.find((b) => b.text === 'MSW handler')
    expect(mswOption).toBeTruthy()

    act(() => {
      mswOption!.onPress!()
    })

    expect(Share.share).toHaveBeenCalledTimes(1)
    const [{ message }] = (Share.share as jest.Mock).mock.calls[0] as [{ message: string; title?: string }]
    // buildMswHandlers emits `http.<method>(...)` handlers keyed by origin+pathname.
    expect(message).toContain('http.get(')
    expect(message).toContain('/users')
  })
})
