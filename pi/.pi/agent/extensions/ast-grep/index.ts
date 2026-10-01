import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { PiExtension } from '@eratio/pi-effect'
import { astGrepPlugin } from './src/extension.ts'

const installAstGrepPlugin = PiExtension.install(astGrepPlugin)

async function astGrepExtension(pi: ExtensionAPI): Promise<void> {
  await installAstGrepPlugin(pi)
}

export { astGrepExtension as default }
