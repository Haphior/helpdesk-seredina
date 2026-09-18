import { describe, expect, it } from 'vitest';
import { LocalEmbeddingAdapter } from './localEmbeddingAdapter';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot; // both vectors are already normalize: true, so dot product IS cosine similarity
}

describe('LocalEmbeddingAdapter', () => {
  // Runs the real ONNX model (no network calls, no API cost) -- slow on a cold
  // model download the first time it runs in an environment, but that's a one-time
  // cache warm, not a per-run cost. See docs/adr/0032-rag-knowledge-base-search.md.
  it('produces 384-dimensional normalized vectors', async () => {
    const adapter = new LocalEmbeddingAdapter();
    const [embedding] = await adapter.embed(['how do I reset my password?']);
    expect(embedding).toHaveLength(384);
    expect(adapter.dimensions).toBe(384);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 1);
  }, 60_000);

  it('ranks a related sentence pair above an unrelated one by cosine similarity', async () => {
    const adapter = new LocalEmbeddingAdapter();
    const [query, related, unrelated] = await adapter.embed([
      'How do I reset my password?',
      'To reset your password, click "Forgot password" on the login screen.',
      'Our office kitchen has a new espresso machine.',
    ]);

    const relatedScore = cosineSimilarity(query, related);
    const unrelatedScore = cosineSimilarity(query, unrelated);

    expect(relatedScore).toBeGreaterThan(unrelatedScore);
  }, 60_000);

  it('returns an empty array for empty input without loading the model', async () => {
    const adapter = new LocalEmbeddingAdapter();
    await expect(adapter.embed([])).resolves.toEqual([]);
  });
});
