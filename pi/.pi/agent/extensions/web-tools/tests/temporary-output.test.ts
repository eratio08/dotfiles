import assert from 'node:assert/strict'
import test from 'node:test'
import { ManagedRuntime } from 'effect'
import {
  createWebToolsTemporaryOutputTestLayer,
  type TemporaryOutputWrite,
  WebToolsTemporaryOutput,
} from '../src/effects/services/temporary-output.ts'

test('should write complete temporary output given the current path layout', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const runtime = ManagedRuntime.make(createWebToolsTemporaryOutputTestLayer(writes, '/tmp/web-tools-test'))

  //when
  const path = await runtime.runPromise(
    WebToolsTemporaryOutput.use((output) => output.writeOutput('pi-webfetch-abcdef12', 'complete untruncated output')),
  )
  await runtime.dispose()

  //then
  assert.equal(path, '/tmp/web-tools-test/pi-webfetch-abcdef12-0/output.txt')
  assert.deepEqual(writes, [
    {
      prefix: 'pi-webfetch-abcdef12',
      content: 'complete untruncated output',
      path: '/tmp/web-tools-test/pi-webfetch-abcdef12-0/output.txt',
    },
  ])
})
