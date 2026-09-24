import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const config = defineConfig({
  input: {
    index: 'src/index.ts',
    output: 'src/output.ts',
    worker: 'src/worker.ts',
  },
  plugins: [dts({ entry: ['src/index.ts', 'src/output.ts'] })],
  external: [/^(?:effect|jiti)(?:\/|$)/, /^node:/],
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
  },
})

export { config as default }
