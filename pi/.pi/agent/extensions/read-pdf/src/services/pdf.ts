import { Context, Effect, Layer, Schema } from 'effect'
import { extractText } from 'unpdf'

interface PdfExtraction {
  readonly pages: readonly string[]
  readonly totalPages: number
}

class PdfExtractionError extends Schema.TaggedError<PdfExtractionError>()('PdfExtractionError', {
  cause: Schema.Unknown,
}) {}

class PdfExtractor extends Context.Service<
  PdfExtractor,
  {
    readonly extract: (data: Uint8Array) => Effect.Effect<PdfExtraction, PdfExtractionError>
  }
>()('read-pdf/services/PdfExtractor') {}

const extract = Effect.fn('PdfExtractor.extract')(function* (
  data: Uint8Array,
): Effect.fn.Return<PdfExtraction, PdfExtractionError> {
  return yield* Effect.tryPromise({
    try: async (signal: AbortSignal) => {
      if (signal.aborted) throw new Error('Operation aborted')
      const result = await extractText(new Uint8Array(data), { mergePages: false })
      if (signal.aborted) throw new Error('Operation aborted')
      return { pages: result.text, totalPages: result.totalPages }
    },
    catch: (cause: unknown) => new PdfExtractionError({ cause }),
  })
})

const PdfExtractorLive: Layer.Layer<PdfExtractor> = Layer.succeed(PdfExtractor, PdfExtractor.of({ extract }))

export { type PdfExtraction, PdfExtractionError, PdfExtractor, PdfExtractorLive }
