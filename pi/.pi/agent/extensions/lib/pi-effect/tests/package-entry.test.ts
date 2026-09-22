import { test } from 'bun:test'
import * as packageEntry from '../src/index.ts'

type PackagePeerModules = {
  readonly effect: typeof import('effect')
  readonly piCodingAgent: typeof import('@earendil-works/pi-coding-agent')
  readonly piTui: typeof import('@earendil-works/pi-tui')
  readonly typebox: typeof import('typebox')
}

const packagePeerModules: PackagePeerModules | undefined = undefined
void packagePeerModules

test('package entrypoint imports as an ESM module', () => {
  //given
  const entry: typeof packageEntry = packageEntry

  //when
  const entryIsObject = typeof entry === 'object'

  //then
  if (!entryIsObject) {
    throw new Error('The package entrypoint must be an object module namespace.')
  }
})

export type { PackagePeerModules }
