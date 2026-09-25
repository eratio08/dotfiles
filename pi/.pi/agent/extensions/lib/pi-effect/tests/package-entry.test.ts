import { test } from 'bun:test'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import * as packageEntry from '@eratio/pi-effect'
import * as testingEntry from '@eratio/pi-effect/testing'

type PackagePeerModules = {
  readonly effect: typeof import('effect')
  readonly piCodingAgent: typeof import('@earendil-works/pi-coding-agent')
  readonly piTui: typeof import('@earendil-works/pi-tui')
  readonly typebox: typeof import('typebox')
}

const packagePeerModules: PackagePeerModules | undefined = undefined
const packageRequire = createRequire(import.meta.url)
void packagePeerModules

test('should import package entry points given an ESM consumer', () => {
  //given
  const entries = [packageEntry, testingEntry]

  //when
  const entriesAreObjects = entries.every((entry) => typeof entry === 'object')

  //then
  if (!entriesAreObjects) {
    throw new Error('The package entrypoints must be object module namespaces.')
  }
})

test('should resolve package entry points given a CommonJS consumer', () => {
  //given
  const entries = ['@eratio/pi-effect', '@eratio/pi-effect/testing']

  //when
  const resolvedEntryNames = entries.map((entry) => basename(packageRequire.resolve(entry)))

  //then
  if (resolvedEntryNames.join(',') !== 'index.js,testing.js') {
    throw new Error('The package entrypoints must resolve for CommonJS consumers.')
  }
})

export type { PackagePeerModules }
