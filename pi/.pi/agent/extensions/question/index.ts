import { PiExtension } from '@eratio/pi-effect'
import { questionPlugin } from './src/extension.ts'

const questionExtension = PiExtension.install(questionPlugin)

export { questionExtension as default }
