import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const config = defineConfig({
  input: {
    index: 'src/index.ts',
    testing: 'src/testing.ts',
  },
  external: [
    /^(?:@earendil-works\/pi-ai|@earendil-works\/pi-coding-agent|@earendil-works\/pi-tui)(?:\/|$)/,
    /^(?:effect|typebox)(?:\/|$)/,
    /^node:/,
  ],
  platform: 'node',
  plugins: [dts()],
  output: {
    dir: 'dist',
    format: 'esm',
  },
})

export { config as default }
