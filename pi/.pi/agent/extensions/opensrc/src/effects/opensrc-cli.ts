import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { planFetch, planList, planRemove, planVersion } from '../core/command-plan.ts'
import type { CliCommandPlan, OpensrcFailure, PiExecutionResult, SourceIndex } from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import { PiHost } from './pi-host.ts'
import { parseSourceIndex } from './source-index.ts'

const MINIMUM_VERSION = [0, 7, 3] as const
const OPENSRC_INSTALL_COMMAND = 'npm install -g opensrc'
const DEFAULT_OPENSRC_BIN = resolve(
  dirname(createRequire(import.meta.url).resolve('opensrc/package.json')),
  'bin/opensrc.js',
)

type OpensrcConfig = {
  readonly bin: string
  readonly home: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

type OpenSrcCliService = {
  readonly preflight: () => Effect.Effect<void, OpensrcFailure>
  readonly list: () => Effect.Effect<SourceIndex, OpensrcFailure>
  readonly fetch: (specs: readonly string[], cwd: string) => Effect.Effect<void, OpensrcFailure>
  readonly remove: (names: readonly string[]) => Effect.Effect<void, OpensrcFailure>
  readonly clean: (plans: readonly CliCommandPlan[]) => Effect.Effect<void, OpensrcFailure>
}

class OpensrcConfiguration extends Context.Service<OpensrcConfiguration, OpensrcConfig>()('opensrc/Configuration') {}

class OpenSrcCli extends Context.Service<OpenSrcCli, OpenSrcCliService>()('opensrc/OpenSrcCli') {}

function resolveOpensrcConfig(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): OpensrcConfig {
  const configuredHome = environment.OPENSRC_HOME?.trim()
  const home = configuredHome ? expandHome(configuredHome, homeDirectory) : resolve(homeDirectory, '.opensrc')
  return {
    bin: environment.OPENSRC_BIN?.trim() || DEFAULT_OPENSRC_BIN,
    home,
    environment: configuredHome ? { OPENSRC_HOME: home } : {},
  }
}

const OpenSrcCliLive: Layer.Layer<OpenSrcCli, never, PiHost | OpensrcConfiguration> = Layer.effect(
  OpenSrcCli,
  Effect.gen(function* () {
    const piHost = yield* PiHost
    const config = yield* OpensrcConfiguration
    const run = (plan: CliCommandPlan, cwd?: string): Effect.Effect<PiExecutionResult, OpensrcFailure> =>
      piHost.exec({
        command: config.bin,
        args: plan.args,
        cwd,
        environment: config.environment,
      })
    const ensurePreflight = yield* Effect.cached(
      Effect.gen(function* () {
        const result = yield* run(planVersion())
        yield* validateResult('preflight', result)
        const version = parseVersion(result.stdout)
        if (version === undefined || compareVersion(version, MINIMUM_VERSION) < 0) {
          return yield* Effect.fail(
            createOpensrcFailure({
              _tag: 'cli',
              operation: 'preflight',
              message: `The opensrc CLI must be version 0.7.3 or newer. Run \`${OPENSRC_INSTALL_COMMAND}\` with Node.js 24 or newer.`,
            }),
          )
        }
      }),
    )
    return OpenSrcCli.of({
      preflight: () => ensurePreflight,
      list: () =>
        Effect.gen(function* () {
          yield* ensurePreflight
          const result = yield* run(planList())
          yield* validateResult('list', result)
          return yield* parseSourceIndex(result.stdout).pipe(
            Effect.mapError((cause) =>
              createOpensrcFailure({
                _tag: 'parser',
                operation: 'list',
                message: cause.message || 'Unable to parse the opensrc source index.',
                cause,
              }),
            ),
          )
        }),
      fetch: (specs: readonly string[], cwd: string) =>
        Effect.gen(function* () {
          yield* ensurePreflight
          const result = yield* run(planFetch(specs, cwd), cwd)
          yield* validateResult('fetch', result)
        }),
      remove: (names: readonly string[]) =>
        Effect.gen(function* () {
          yield* ensurePreflight
          const result = yield* run(planRemove(names))
          yield* validateResult('remove', result)
        }),
      clean: (plans: readonly CliCommandPlan[]) =>
        Effect.gen(function* () {
          yield* ensurePreflight
          for (const plan of plans) {
            const result = yield* run(plan)
            yield* validateResult('clean', result)
          }
        }),
    })
  }),
)

function validateResult(operation: string, result: PiExecutionResult): Effect.Effect<void, OpensrcFailure> {
  if (result.killed) return Effect.fail(cancellationFailure(operation))
  if (result.code === 0) return Effect.void
  const detail = result.stderr.trim().split('\n')[0] || `opensrc ${operation} failed with exit code ${result.code}`
  const message = operation === 'preflight' ? `${detail}. Run \`${OPENSRC_INSTALL_COMMAND}\` and try again.` : detail
  return Effect.fail(createOpensrcFailure({ _tag: 'cli', operation, message, cause: { code: result.code } }))
}

function parseVersion(output: string): readonly [number, number, number] | undefined {
  const match = /(?:opensrc\s+)?(\d+)\.(\d+)\.(\d+)/i.exec(output)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersion(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function expandHome(value: string, homeDirectory: string): string {
  if (value === '~') return homeDirectory
  if (value.startsWith('~/')) return resolve(homeDirectory, value.slice(2))
  return isAbsolute(value) ? value : resolve(value)
}

function cancellationFailure(operation: string): OpensrcFailure {
  return createOpensrcFailure({ _tag: 'cancellation', operation, message: 'The opensrc operation was cancelled.' })
}

export {
  OpenSrcCli,
  OpenSrcCliLive,
  type OpenSrcCliService,
  type OpensrcConfig,
  OpensrcConfiguration,
  resolveOpensrcConfig,
}
