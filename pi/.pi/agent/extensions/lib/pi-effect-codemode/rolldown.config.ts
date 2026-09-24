import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

const config = defineConfig({
  input: {
    index: 'src/index.ts',
    worker: 'node_modules/@eratio/pi-codemode-core/src/worker.ts',
  },
  plugins: [dts({ entry: 'src/index.ts', resolver: 'tsc' })],
  resolve: {
    alias: {
      '@eratio/pi-codemode-core/output': '../pi-codemode-core/src/output.ts',
      '@eratio/pi-codemode-core': '../pi-codemode-core/src/index.ts',
      '@eratio08/pi-effect': '../pi-effect/src/index.ts',
    },
  },
  external: [/^(?:@earendil-works\/pi-coding-agent|@earendil-works\/pi-tui|effect|jiti|typebox)(?:\/|$)/, /^node:/],
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
  },
})

export { config as default }
