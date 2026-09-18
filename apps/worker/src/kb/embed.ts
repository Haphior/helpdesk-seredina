import { randomUUID } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { chunkText, LocalEmbeddingAdapter, toPgVector } from '@seredina/ai-adapters';

const embeddingAdapter = new LocalEmbeddingAdapter();

/**
 * Consumes EMBED_KB_ARTICLE_QUEUE_NAME (see docs/adr/0032-rag-knowledge-base-search.md).
 * Re-chunks and re-embeds the article's CURRENT title+body from scratch on every
 * run rather than diffing -- articles are edited rarely and chunk counts are small,
 * so full replace is simpler than incremental chunk reconciliation.
 *
 * `KbChunk.embedding` is `Unsupported("vector(384)")` in schema.prisma, so every
 * read/write of it goes through raw SQL, never Prisma's normal query API -- see
 * that model's doc comment. Raw SQL bypasses the Prisma Client Extension (the
 * tenant-guard in packages/db/src/prisma.ts), so `tenant_id` is set explicitly on
 * every raw statement below as defense in depth; Postgres RLS (bound by
 * withTenantTx's set_config, still in effect on this same transaction) is the
 * backstop that would catch a mistake here.
 */
export async function embedKbArticle(tenantId: string, kbArticleId: string): Promise<void> {
  const article = await withTenantTx(prisma, tenantId, async (tx) => {
    return tx.kbArticle.findUnique({ where: { id: kbArticleId } });
  });
  if (!article) return;

  const chunks = chunkText(`${article.title}\n\n${article.body}`);
  if (chunks.length === 0) {
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.$executeRaw`DELETE FROM kb_chunks WHERE kb_article_id = ${kbArticleId}::uuid AND tenant_id = ${tenantId}::uuid`;
    });
    return;
  }

  // CPU-bound local inference, not network I/O -- but still kept outside the
  // transaction below for the same reason withTenantTx's own docs give for
  // external calls: no reason to hold a pooled connection open while it runs.
  const embeddings = await embeddingAdapter.embed(chunks);

  await withTenantTx(prisma, tenantId, async (tx) => {
    await tx.$executeRaw`DELETE FROM kb_chunks WHERE kb_article_id = ${kbArticleId}::uuid AND tenant_id = ${tenantId}::uuid`;
    for (let i = 0; i < chunks.length; i += 1) {
      const vector = toPgVector(embeddings[i]);
      await tx.$executeRaw`
        INSERT INTO kb_chunks (id, tenant_id, kb_article_id, content, embedding, created_at)
        VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${kbArticleId}::uuid, ${chunks[i]}, ${vector}::vector, now())
      `;
    }
  });
}
