import { Context, Effect, Layer } from 'effect'
import type { WebSearchEnvironment } from '../../core/websearch.ts'

class WebSearchConfig extends Context.Service<WebSearchConfig, WebSearchEnvironment>()('web-tools/WebSearchConfig') {}

function WebSearchConfigLive(): Layer.Layer<WebSearchConfig> {
  return Layer.effect(
    WebSearchConfig,
    Effect.sync(() =>
      WebSearchConfig.of({
        EXA_API_KEY: process.env.EXA_API_KEY,
        PARALLEL_API_KEY: process.env.PARALLEL_API_KEY,
        PI_WEBSEARCH_PROVIDER: process.env.PI_WEBSEARCH_PROVIDER,
      }),
    ),
  )
}

export { WebSearchConfig, WebSearchConfigLive, type WebSearchEnvironment }
