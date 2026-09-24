import { test } from 'bun:test'
import * as packageEntry from '@eratio08/pi-effect'
import * as testingEntry from '@eratio08/pi-effect/testing'

type PackagePeerModules = {
  readonly effect: typeof import('effect')
  readonly piCodingAgent: typeof import('@earendil-works/pi-coding-agent')
  readonly piTui: typeof import('@earendil-works/pi-tui')
  readonly typebox: typeof import('typebox')
}

const packagePeerModules: PackagePeerModules | undefined = undefined
void packagePeerModules

test('package entrypoints import as ESM modules', () => {
  //given
  const entries = [packageEntry, testingEntry]

  //when
  const entriesAreObjects = entries.every((entry) => typeof entry === 'object')

  //then
  if (!entriesAreObjects) {
    throw new Error('The package entrypoints must be object module namespaces.')
  }
})

export type { PackagePeerModules }
