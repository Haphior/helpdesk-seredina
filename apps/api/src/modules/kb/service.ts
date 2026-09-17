import { prisma, withTenantTx, type Prisma } from '@seredina/db';

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (e.g. "café" -> "cafe") left behind by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'article';
}

/** Appends -2, -3, ... until the slug is free within this tenant -- titles collide more often than IDs do. */
async function uniqueSlug(tx: Prisma.TransactionClient, tenantId: string, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (await tx.kbArticle.findUnique({ where: { tenantId_slug: { tenantId, slug } } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function searchFilter(q?: string): Prisma.KbArticleWhereInput | undefined {
  if (!q?.trim()) return undefined;
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
    ],
  };
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export async function listKbArticles(tenantId: string, q?: string, limit?: number, offset?: number) {
  const take = Math.min(limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const skip = offset ?? 0;
  const where = searchFilter(q);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const [articles, total] = await Promise.all([
      tx.kbArticle.findMany({
        where,
        include: { author: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
      }),
      tx.kbArticle.count({ where }),
    ]);
    return { articles, total };
  });
}

export async function getKbArticle(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const article = await tx.kbArticle.findUnique({ where: { id }, include: { author: { select: { id: true, name: true } } } });
    if (!article) throw new Error('article not found');
    return article;
  });
}

export interface CreateKbArticleInput {
  title: string;
  body: string;
  published?: boolean;
  authorUserId?: string | null;
}

export async function createKbArticle(tenantId: string, input: CreateKbArticleInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const slug = await uniqueSlug(tx, tenantId, input.title);
    return tx.kbArticle.create({
      data: {
        tenantId,
        title: input.title,
        slug,
        body: input.body,
        published: input.published ?? false,
        authorUserId: input.authorUserId ?? null,
      },
      include: { author: { select: { id: true, name: true } } },
    });
  });
}

export interface UpdateKbArticleInput {
  title?: string;
  body?: string;
  published?: boolean;
}

/** Title can change freely -- the slug, once assigned at creation, never does (see schema comment). */
export async function updateKbArticle(tenantId: string, id: string, input: UpdateKbArticleInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.kbArticle.findUnique({ where: { id } });
    if (!existing) throw new Error('article not found');
    return tx.kbArticle.update({
      where: { id },
      data: { title: input.title, body: input.body, published: input.published },
      include: { author: { select: { id: true, name: true } } },
    });
  });
}

export async function deleteKbArticle(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.kbArticle.findUnique({ where: { id } });
    if (!existing) throw new Error('article not found');
    await tx.kbArticle.delete({ where: { id } });
  });
}

// --- Public, unauthenticated self-service portal -- see modules/kb/routes.ts and
// docs/adr/0018-knowledge-base.md. Both functions filter published: true up front,
// never rely on the caller to check it afterward.

export async function listPublishedKbArticles(tenantId: string, q?: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.kbArticle.findMany({
      where: { published: true, ...searchFilter(q) },
      select: { id: true, title: true, slug: true, updatedAt: true },
      orderBy: { title: 'asc' },
    }),
  );
}

export async function getPublishedKbArticleBySlug(tenantId: string, slug: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const article = await tx.kbArticle.findUnique({ where: { tenantId_slug: { tenantId, slug } } });
    if (!article || !article.published) throw new Error('article not found');
    return { id: article.id, title: article.title, slug: article.slug, body: article.body, updatedAt: article.updatedAt };
  });
}
