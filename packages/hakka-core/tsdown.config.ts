import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', test: 'src/test/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  clean: true,
})
