import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context } from 'effect'

class OpensrcContext extends Context.Service<OpensrcContext, ExtensionContext>()('opensrc/Context') {}

export { OpensrcContext }
