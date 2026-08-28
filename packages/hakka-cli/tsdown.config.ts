import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts', 'src/mcp/index.ts', 'src/cdp/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  clean: true,
  deps: { neverBundle: ['hakka-core', 'hakka-core/test', 'hakka-bridge', 'ws', 'zod', '@modelcontextprotocol/sdk'] },
})
