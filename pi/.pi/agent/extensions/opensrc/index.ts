import { type PiExtensionError, type PiProcess, type PiRegistrationContext, PiToolContext } from '@eratio/pi-effect'
import { createTool, PiExtension } from '@eratio/pi-effect-codemode'
import { Effect } from 'effect'
import { OPENSRC_CODE_TYPES } from './src/core/code-mode.ts'
import type { OpensrcFailure } from './src/core/model.ts'
import { opensrcErrorCodec, opensrcMethods } from './src/effects/code-mode.ts'
import { createOpensrcApi, type OpensrcApiService } from './src/effects/opensrc-api.ts'
import { resolveOpensrcConfig } from './src/effects/opensrc-cli.ts'
import { createCallLayer } from './src/effects/runtime.ts'

type OpenSrcWithRun = NonNullable<
  Parameters<typeof createTool<PiToolContext | PiProcess, OpensrcFailure, OpensrcApiService>>[0]['withRun']
>

const opensrcTool = createTool<PiToolContext | PiProcess, OpensrcFailure, OpensrcApiService>({
  toolName: 'opensrc',
  label: 'OpenSrc',
  description:
    'Fetch and inspect package and repository source. Batch dependent calls in one program. If you know a source spec and file path, call `fetch` then `read` directly; use `resolve` or `files` only to discover an unknown spec or path. Call `api.help("operation")` when you need a signature and parameter schema. Use `source.name` after `fetch`. Catch OpenSrc host failures as `OpensrcHostError` and read their typed value.',
  methods: opensrcMethods,
  typeDeclarations: OPENSRC_CODE_TYPES,
  examples: [
    `export default async (api: opensrcApi) => {
  const [{ source }] = await api.fetch({ specs: ['zod'] })
  return await api.readMany({ sourceName: source.name, paths: ['package.json', 'README.md'] })
}`,
    `export default async (api: opensrcApi) => {
  return await api.grep({ pattern: 'parse', options: { sources: ['zod'], include: '**/*.ts' } })
}`,
    `export default async (api: opensrcApi) => {
  try {
    return await api.read({ sourceName: 'zod', filePath: 'missing.ts' })
  } catch (error) {
    const failure = (error as OpensrcHostError).value
    return { tag: failure._tag, operation: failure.operation, message: failure.message }
  }
}`,
  ],
  timeoutMs: 30_000,
  executionMode: 'sequential',
  errorCodec: opensrcErrorCodec,
  withRun: (run: Parameters<OpenSrcWithRun>[0], signal: Parameters<OpenSrcWithRun>[1]) =>
    Effect.gen(function* () {
      const context = yield* PiToolContext
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const api = yield* createOpensrcApi(signal)
          return yield* run(api)
        }).pipe(Effect.provide(createCallLayer({ cwd: context.cwd }, resolveOpensrcConfig()))),
      )
    }),
})

const opensrcPlugin = PiExtension.define({
  id: 'opensrc',
  // PiEffect provides run services at execution, but the SDK registry type omits them.
  effect: (registrations: PiRegistrationContext<never, PiExtensionError>) =>
    opensrcTool.register(registrations.tools as unknown as Parameters<typeof opensrcTool.register>[0]),
})

const opensrcExtension = PiExtension.install(opensrcPlugin)

export { opensrcExtension as default }
