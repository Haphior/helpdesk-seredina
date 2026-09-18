-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kb_article_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_chunks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_kb_article_id_fkey" FOREIGN KEY ("kb_article_id") REFERENCES "kb_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- HNSW, not IVFFlat: no training/list-count tuning needed and better recall at
-- this table's expected size. Prisma's schema DSL has no vector operator class
-- concept, so this is hand-appended (see docs/adr/0032-rag-knowledge-base-search.md).
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);
