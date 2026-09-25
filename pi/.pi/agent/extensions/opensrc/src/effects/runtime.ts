import type { PiProcess } from '@eratio/pi-effect'
import { Layer } from 'effect'
import { OpensrcContext, type OpensrcContextValue } from './context.ts'
import { type FileSystem, FileSystemLive } from './file-system.ts'
import { type AstParser, AstParserLive } from './opensrc-api.ts'
import { type OpenSrcCli, OpenSrcCliLive, type OpensrcConfig, OpensrcConfiguration } from './opensrc-cli.ts'
import { type PiHost, PiHostLive } from './pi-host.ts'
import { type SourceStore, SourceStoreLive } from './source-store.ts'

function createCallLayer(
  context: OpensrcContextValue,
  config: OpensrcConfig,
): Layer.Layer<
  OpensrcContext | FileSystem | AstParser | OpensrcConfiguration | PiHost | OpenSrcCli | SourceStore,
  never,
  PiProcess
> {
  const hostLayer = Layer.mergeAll(PiHostLive, Layer.succeed(OpensrcConfiguration, config))
  const cliLayer = OpenSrcCliLive.pipe(Layer.provideMerge(hostLayer))
  const storeLayer = SourceStoreLive().pipe(Layer.provideMerge(cliLayer))
  return Layer.mergeAll(Layer.succeed(OpensrcContext, context), FileSystemLive(), AstParserLive(), storeLayer)
}

export { createCallLayer }
