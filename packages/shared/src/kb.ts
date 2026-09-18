// apps/api enqueues after a KbArticle's body is created/changed; only
// apps/worker consumes it (it's the only place the embedding model is loaded
// -- see packages/ai-adapters' LocalEmbeddingAdapter). See
// docs/adr/0032-rag-knowledge-base-search.md.

export const EMBED_KB_ARTICLE_QUEUE_NAME = 'embed-kb-article';

export interface EmbedKbArticleJobPayload {
  tenantId: string;
  kbArticleId: string;
}
