import type { EmbeddingProviderAdapter } from './types';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Local, zero-API-cost embeddings via a small ONNX model run in-process
 * (see docs/adr/0032-rag-knowledge-base-search.md). Lazily loaded and cached
 * as a module-level singleton -- the model download/load happens once per
 * process, not once per embed() call, since apps/worker embeds many articles
 * over its lifetime.
 */
let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL_ID) as unknown as Promise<FeatureExtractionPipeline>,
    );
  }
  return pipelinePromise;
}

export class LocalEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await getPipeline();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}
