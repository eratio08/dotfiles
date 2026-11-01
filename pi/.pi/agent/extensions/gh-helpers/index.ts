import { PiExtension, type PiRegistrationContext } from '@eratio/pi-effect'
import { Effect } from 'effect'
import { handleCreatePullRequest, openCurrentPullRequest } from './src/extension.ts'

const ghHelpersPlugin = PiExtension.define({
  id: 'gh-helpers',
  effect: ({ commands }: PiRegistrationContext<never>) =>
    Effect.gen(function* () {
      yield* commands.register('ghpr', {
        description: 'Push the current branch and create a pull request',
        handler: () => handleCreatePullRequest(false),
      })
      yield* commands.register('ghprd', {
        description: 'Push the current branch and create a draft pull request',
        handler: () => handleCreatePullRequest(true),
      })
      yield* commands.register('ghv', {
        description: 'Open the current branch pull request in the browser',
        handler: () => openCurrentPullRequest(),
      })
    }),
})

const ghHelpersExtension = PiExtension.install(ghHelpersPlugin)

export { ghHelpersExtension as default }
