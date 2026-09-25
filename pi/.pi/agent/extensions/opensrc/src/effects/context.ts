import { Context } from 'effect'

type OpensrcContextValue = { readonly cwd: string }

class OpensrcContext extends Context.Service<OpensrcContext, OpensrcContextValue>()('opensrc/Context') {}

export { OpensrcContext, type OpensrcContextValue }
