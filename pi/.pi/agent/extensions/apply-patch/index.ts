import type { AgentToolResult, Theme, ToolDefinition, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent'
import { keyHint, withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { type EffectToolDefinition, PiExtension, type PiRegistrationContext, PiToolContext } from '@eratio/pi-effect'
import { Effect } from 'effect'
import { type Static, Type } from 'typebox'
import { type AppliedFile, ApplyPatchError, applyPatch, PatchMutationQueue, parsePatch } from './src/patch.ts'

const parameters = Type.Object({
  patchText: Type.String({ description: 'OpenCode-style patch text enclosed by *** Begin Patch and *** End Patch' }),
})

type ApplyPatchDetails = { files: AppliedFile[] }

type ApplyPatchRenderContext = Parameters<
  NonNullable<ToolDefinition<typeof parameters, ApplyPatchDetails>['renderCall']>
>[2]

const withFileMutationQueueEffect = Effect.fn('withFileMutationQueueEffect')(function* <A, E, R>(
  path: string,
  action: Effect.Effect<A, E, R>,
): Effect.fn.Return<A, E | ApplyPatchError, R> {
  return yield* Effect.callback<A, E | ApplyPatchError, R>((resume, signal) => {
    let cancelled = false
    const queued = withFileMutationQueue(path, () => {
      if (cancelled || signal.aborted) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resume(Effect.ensuring(action, Effect.sync(resolve)))
      })
    })
    void queued.catch((cause: unknown) => {
      if (cancelled || signal.aborted) return
      resume(
        Effect.fail(
          new ApplyPatchError({
            operation: 'filesystem',
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
        ),
      )
    })
    return Effect.sync(() => {
      cancelled = true
    })
  })
})

const patchMutationQueue = PatchMutationQueue.of({ withLock: withFileMutationQueueEffect })

const applyPatchTool: EffectToolDefinition<typeof parameters, never, ApplyPatchError, ApplyPatchDetails> = {
  name: 'apply_patch',
  label: 'apply_patch',
  description:
    'Apply an OpenCode-style multi-file patch. Supports *** Add File, *** Update File, *** Move to, and *** Delete File sections inside *** Begin Patch / *** End Patch. Paths must be project-relative. Every update hunk must match exactly once. Use apply_patch for coordinated multi-file changes; use edit for precise one-file replacements.',
  promptSnippet: 'Apply verified multi-file add, update, move, and delete patches',
  promptGuidelines: [
    'Use apply_patch for coordinated multi-file add, update, move, or delete changes.',
    'Use apply_patch only with an OpenCode-style patch enclosed by *** Begin Patch and *** End Patch.',
    'Use edit instead of apply_patch for precise changes within one existing file.',
  ],
  parameters,
  exposure: 'codemode',
  execute: Effect.fn('applyPatchTool.execute')(function* (params: Static<typeof parameters>) {
    const context = yield* PiToolContext
    const operations = yield* parsePatch(params.patchText)
    const files = yield* Effect.provideService(
      applyPatch(context.cwd, operations),
      PatchMutationQueue,
      patchMutationQueue,
    )
    return {
      content: [{ type: 'text', text: summary(files) }],
      details: { files } satisfies ApplyPatchDetails,
    }
  }),
  renderCall(_args: Static<typeof parameters>, theme: Theme, context: ApplyPatchRenderContext): Text {
    const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
    text.setText(theme.fg('toolTitle', theme.bold('apply_patch')))
    return text
  },
  renderResult(
    result: AgentToolResult<ApplyPatchDetails>,
    { expanded, isPartial }: ToolRenderResultOptions,
    theme: Theme,
    context: ApplyPatchRenderContext,
  ): Text {
    const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
    if (isPartial) {
      text.setText(theme.fg('warning', 'Applying patch...'))
      return text
    }
    const details = result.details as ApplyPatchDetails | undefined
    if (!details) {
      const content = result.content[0]
      text.setText(theme.fg(context.isError ? 'error' : 'muted', content?.type === 'text' ? content.text : ''))
      return text
    }
    let output = details.files.map(renderFile).join('\n')
    if (expanded) {
      output += `\n\n${details.files.map((file) => theme.fg('toolOutput', file.diff)).join('\n\n')}`
    } else {
      output += theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)
    }
    text.setText(output)
    return text
  },
}

const applyPatchPlugin = PiExtension.define({
  id: 'apply-patch',
  effect: (registrations: PiRegistrationContext<never>) => registrations.tools.register(applyPatchTool),
})
const applyPatchExtension = PiExtension.install(applyPatchPlugin)

function summary(files: AppliedFile[]): string {
  return `Applied patch:\n${files.map((file) => `${operationCode(file)} ${displayPath(file)}`).join('\n')}`
}

function renderFile(file: AppliedFile): string {
  return `${operationCode(file)} ${displayPath(file)} +${file.additions} -${file.deletions}`
}

function operationCode(file: AppliedFile): string {
  if (file.type === 'add') return 'A'
  if (file.type === 'delete') return 'D'
  if (file.type === 'move') return 'R'
  return 'M'
}

function displayPath(file: AppliedFile): string {
  return file.destination ? `${file.path} -> ${file.destination}` : file.path
}

export { applyPatchExtension as default }
