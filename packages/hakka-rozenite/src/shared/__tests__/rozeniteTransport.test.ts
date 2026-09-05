import { getRozeniteDevToolsClient } from '@rozenite/plugin-bridge'
import { connectFakePair, waitForMessage } from '@rozenite/testing'
import type { NetworkRequest } from 'hakka-core'
import { describe, expect, it } from 'vitest'

import { createHakkaRozeniteBridge } from '../../react-native/bridge'
import { createPanelStore } from '../../ui/panelStore'
import { HAKKA_ROZENITE_PLUGIN_ID, type HakkaRozeniteEventMap } from '../protocol'

const request = {
  id: 'transport-request',
  url: 'https://api.example.com/v1/transport',
  method: 'GET',
  status: 200,
  startTime: 1,
  endTime: 2,
  duration: 1,
} as NetworkRequest

describe('Rozenite 2 transport', () => {
  it('carries captured traffic and clear controls between the device and panel', async () => {
    const { device, panel } = connectFakePair()
    const deviceClient = await getRozeniteDevToolsClient<HakkaRozeniteEventMap>(HAKKA_ROZENITE_PLUGIN_ID, {
      channel: device,
    })
    const panelClient = await getRozeniteDevToolsClient<HakkaRozeniteEventMap>(HAKKA_ROZENITE_PLUGIN_ID, {
      channel: panel,
    })

    let clearCount = 0
    const receivedRequest = waitForMessage(panelClient, 'request', { timeoutMs: 1_000 })
    const teardown = createHakkaRozeniteBridge(deviceClient, {
      getLogs: () => [request],
      onRequest: () => () => undefined,
      clearLogs: () => {
        clearCount += 1
      },
    })
    const store = createPanelStore(panelClient)

    await expect(receivedRequest).resolves.toEqual(request)
    await expect(store.getSnapshot()).resolves.toEqual([request])

    const cleared = waitForMessage(panelClient, 'cleared', { timeoutMs: 1_000 })
    store.clear()
    await expect(cleared).resolves.toEqual({})
    expect(clearCount).toBe(1)
    await expect(store.getSnapshot()).resolves.toEqual([])

    store.destroy()
    teardown()
    deviceClient.close()
    panelClient.close()
  })
})
