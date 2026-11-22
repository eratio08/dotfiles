import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerBiomeAntiSlopCommands } from './src/extension.ts'

function biomeAntiSlopExtension(pi: ExtensionAPI): void {
  registerBiomeAntiSlopCommands(pi)
}

export { biomeAntiSlopExtension as default }
