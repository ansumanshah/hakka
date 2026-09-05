import assert from 'node:assert/strict'

const [core, bridge, node, nodeCi, mcp, cdp] = await Promise.all([
  import('../packages/hakka-core/dist/index.mjs'),
  import('../packages/hakka-bridge/dist/index.mjs'),
  import('../packages/hakka-node/dist/index.mjs'),
  import('../packages/hakka-node/dist/ci/index.mjs'),
  import('../packages/hakka-cli/dist/mcp/index.mjs'),
  import('../packages/hakka-cli/dist/cdp/index.mjs'),
])

assert.equal(typeof core.RingBuffer, 'function')
assert.equal(typeof bridge.startBridgeServer, 'function')
assert.equal(typeof node.startCapture, 'function')
assert.equal(typeof nodeCi.diffBaseline, 'function')
assert.equal(typeof mcp.main, 'function')
assert.equal(typeof cdp.runCdpAttach, 'function')

console.log(`Node ${process.versions.node}: server and CLI entrypoints loaded`)
