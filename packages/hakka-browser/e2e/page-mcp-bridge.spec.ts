import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { expect, test } from '@playwright/test'
import { startBridgeServer } from 'hakka-bridge'

import { createBridgeListener } from '../../hakka-cli/src/mcp/bridgeListener.js'
import { RequestStore } from '../../hakka-cli/src/mcp/RequestStore.js'
import { registerPageTools } from '../../hakka-cli/src/mcp/tools/pageTools.js'

let bridge: Awaited<ReturnType<typeof startBridgeServer>>
let listener: ReturnType<typeof createBridgeListener>
let server: McpServer
let client: Client
let bridgeUrl: string

function toolPayload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content[0]
  if (!content || content.type !== 'text') throw new Error('Expected an MCP text result')
  return JSON.parse(content.text) as Record<string, unknown>
}

test.beforeAll(async () => {
  bridge = await startBridgeServer({ port: 0, advertise: false })
  bridgeUrl = `ws://127.0.0.1:${bridge.port}`
  listener = createBridgeListener(new RequestStore(), bridgeUrl)

  server = new McpServer({ name: 'page-e2e', version: '1' })
  registerPageTools(server, listener)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'page-e2e-client', version: '1' })
  await client.connect(clientTransport)
})

test.afterAll(async () => {
  await client.close()
  await server.close()
  listener.close()
  await bridge.close()
})

test('built browser runtime supports inspect, opt-in edit, and exact undo through bridge MCP tools', async ({
  page,
}) => {
  await page.goto('/examples/browser-demo/index.html')
  await expect(page.locator('.hakka-panel.open')).toBeVisible({ timeout: 15_000 })
  await page.evaluate((url) => {
    const target = document.createElement('button')
    target.id = 'page-mcp-target'
    const child = document.createElement('span')
    child.textContent = 'before'
    target.append(child)
    target.addEventListener('click', () => {
      ;(window as unknown as { pageMcpClicks?: number }).pageMcpClicks =
        ((window as unknown as { pageMcpClicks?: number }).pageMcpClicks ?? 0) + 1
    })
    document.body.append(target)
    ;(window as unknown as { Hakka: { connect(url: string): void } }).Hakka.connect(url)
  }, bridgeUrl)

  await expect.poll(() => listener.getTargets().find((target) => target.runtime === 'browser')?.id).toBeTruthy()
  const targetId = listener.getTargets().find((target) => target.runtime === 'browser')!.id
  const toolNames = (await client.listTools()).tools.map((tool) => tool.name)
  expect(toolNames).toEqual(expect.arrayContaining(['inspect_page', 'edit_page', 'undo_page']))

  const inspected = await client.callTool({
    name: 'inspect_page',
    arguments: { targetId, selector: '#page-mcp-target', limit: 1 },
  })
  expect(toolPayload(inspected)).toMatchObject({
    elements: [{ selector: '#page-mcp-target', tagName: 'button', text: 'before' }],
  })

  const denied = await client.callTool({
    name: 'edit_page',
    arguments: { targetId, selector: '#page-mcp-target', text: 'after' },
  })
  expect(denied.isError).toBe(true)
  await expect(page.locator('#page-mcp-target')).toHaveText('before')

  await page.getByRole('tab', { name: 'Page' }).click()
  await page.getByLabel('Allow remote edits this session').check()
  const edited = await client.callTool({
    name: 'edit_page',
    arguments: { targetId, selector: '#page-mcp-target', text: 'after' },
  })
  expect(edited.isError).toBeUndefined()
  const changeId = toolPayload(edited).changeId
  expect(typeof changeId).toBe('string')
  await expect(page.locator('#page-mcp-target')).toHaveText('after')

  const undone = await client.callTool({ name: 'undo_page', arguments: { targetId, changeId } })
  expect(undone.isError).toBeUndefined()
  await expect(page.locator('#page-mcp-target > span')).toHaveText('before')
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#page-mcp-target')?.click())
  expect(await page.evaluate(() => (window as unknown as { pageMcpClicks?: number }).pageMcpClicks)).toBe(1)
})
