import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  clean: true,
  deps: { neverBundle: ['hakka-core', 'ws'] },
})
