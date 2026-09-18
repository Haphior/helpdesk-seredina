import { prisma, withTenantTx } from '@seredina/db';
import { LocalEmbeddingAdapter, toPgVector } from '@seredina/ai-adapters';

const embeddingAdapter = new LocalEmbeddingAdapter();

export interface KbSearchResult {
  kbArticleId: string;
  title: string;
  slug: string;
  content: string;
  similarity: number;
}

interface KbChunkSearchRow {
  kb_article_id: string;
  content: string;
  title: string;
  slug: string;
  similarity: number;
}

const DEFAULT_LIMIT = 5;

/**
 * Semantic search over KbChunk (see docs/adr/0032-rag-knowledge-base-search.md).
 * Embeds the query with the same adapter/model used to embed chunks -- a
 * mismatched model would produce vectors in a different space, making cosine
 * distance meaningless -- then ranks by cosine similarity via pgvector's `<=>`
 * operator (`1 - distance`, since MiniLM's output is already normalized).
 *
 * Raw SQL bypasses the Prisma Client Extension (packages/db/src/prisma.ts), so
 * `tenant_id` is filtered explicitly here as defense in depth; Postgres RLS
 * (bound by withTenantTx's set_config on this same transaction) is the backstop.
 * Joins to kb_articles for title/slug but deliberately does NOT filter on
 * `published` -- see KbChunk's schema.prisma comment on why this is a different,
 * internal-agent trust boundary than the public self-service portal.
 */
export async function searchKnowledgeBase(
  tenantId: string,
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<KbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [embedding] = await embeddingAdapter.embed([trimmed]);
  const vector = toPgVector(embedding);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRaw<KbChunkSearchRow[]>`
      SELECT
        kc.kb_article_id,
        kc.content,
        ka.title,
        ka.slug,
        1 - (kc.embedding <=> ${vector}::vector) AS similarity
      FROM kb_chunks kc
      JOIN kb_articles ka ON ka.id = kc.kb_article_id
      WHERE kc.tenant_id = ${tenantId}::uuid
        AND ka.tenant_id = ${tenantId}::uuid
        AND kc.embedding IS NOT NULL
      ORDER BY kc.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      kbArticleId: row.kb_article_id,
      title: row.title,
      slug: row.slug,
      content: row.content,
      similarity: row.similarity,
    }));
  });
}
