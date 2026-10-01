import { PiExtension, type PiRegistrationContext } from '@eratio/pi-effect'
import { Effect } from 'effect'
import {
  clearHerdrCompactionBlock,
  HerdrBlockerState,
  handleHerdrAgentSettled,
  handleHerdrSessionCompact,
  handleHerdrTurnStart,
} from './src/extension.ts'

const herdrBlockerPlugin = PiExtension.define<HerdrBlockerState>({
  id: 'herdr-blocker',
  layer: HerdrBlockerState.layer,
  effect: (context: PiRegistrationContext<HerdrBlockerState>) =>
    Effect.gen(function* () {
      yield* context.events.on('session_compact', handleHerdrSessionCompact)
      yield* context.events.on('turn_start', handleHerdrTurnStart)
      yield* context.events.on('agent_settled', handleHerdrAgentSettled)
      yield* context.events.on('agent_start', clearHerdrCompactionBlock)
      yield* context.events.on('session_shutdown', clearHerdrCompactionBlock)
    }),
})

const herdrBlockerExtension = PiExtension.install(herdrBlockerPlugin)

export { herdrBlockerExtension as default }
