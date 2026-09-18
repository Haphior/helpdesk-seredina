export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteInput {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  // Which model actually served this call -- the adapter is the source of
  // truth (it may differ from a hardcoded default via ANTHROPIC_MODEL), so
  // callers that log cost/usage (see pricing.ts) never have to re-derive it.
  model: string;
}

/**
 * Provider-agnostic seam for every AI feature (copilot now, autonomous mode and
 * the MCP server's shared tool catalog later -- see docs/ROADMAP.md's Phase 3).
 * A route/service never talks to @anthropic-ai/sdk directly; it only ever depends
 * on this interface, so swapping providers or substituting a test double never
 * touches call sites.
 */
export interface LlmProviderAdapter {
  complete(input: CompleteInput): Promise<CompleteResult>;
}

/**
 * Same provider-agnostic-seam pattern as LlmProviderAdapter, for embeddings
 * (RAG substrate -- see docs/adr/0032-rag-knowledge-base-search.md). `dimensions`
 * is a property, not a magic number scattered across call sites, because the
 * vector column width (`KbChunk.embedding vector(384)` in schema.prisma) is
 * pinned to whichever adapter actually wrote the data -- swapping to a
 * higher-dimension provider later means a migration, and this property is what
 * a future migration script would assert against before running.
 */
export interface EmbeddingProviderAdapter {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
