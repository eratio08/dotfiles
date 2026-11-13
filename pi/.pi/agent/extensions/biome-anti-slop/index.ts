import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerBiomeAntiSlopTool } from './src/extension.ts'

function biomeAntiSlopExtension(pi: ExtensionAPI): void {
  registerBiomeAntiSlopTool(pi)
}

export { biomeAntiSlopExtension as default }
