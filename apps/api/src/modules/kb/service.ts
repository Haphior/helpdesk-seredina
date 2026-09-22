import bcrypt from 'bcryptjs';
import { prisma, withTenantTx, type Prisma } from '@seredina/db';
import { embedKbArticleQueue } from '../../lib/queue';

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
  const article = await withTenantTx(prisma, tenantId, async (tx) => {
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
  // Outside the transaction -- enqueueing is network I/O against Redis, never
  // called while a tenant transaction holds a pooled connection open.
  await embedKbArticleQueue.add('embed', { tenantId, kbArticleId: article.id });
  return article;
}

export interface UpdateKbArticleInput {
  title?: string;
  body?: string;
  published?: boolean;
}

/** Title can change freely -- the slug, once assigned at creation, never does (see schema comment). */
export async function updateKbArticle(tenantId: string, id: string, input: UpdateKbArticleInput) {
  const { article, bodyChanged } = await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.kbArticle.findUnique({ where: { id } });
    if (!existing) throw new Error('article not found');
    const updated = await tx.kbArticle.update({
      where: { id },
      data: { title: input.title, body: input.body, published: input.published },
      include: { author: { select: { id: true, name: true } } },
    });
    // Title feeds into the embedded text alongside the body (see embed.ts), so
    // a title-only rename also needs re-embedding, not just a body edit.
    const changed =
      (input.body !== undefined && input.body !== existing.body) ||
      (input.title !== undefined && input.title !== existing.title);
    return { article: updated, bodyChanged: changed };
  });
  if (bodyChanged) {
    await embedKbArticleQueue.add('embed', { tenantId, kbArticleId: article.id });
  }
  return article;
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

// --- Public portal access control -- gates the /public/:tenantSlug/kb-* routes
// themselves (before any article is ever fetched), separate from the per-article
// published flag above. See docs/adr/0051-kb-portal-access-control.md for why:
// "published" alone left the portal permanently, unconditionally open to anyone
// with a link, with no way to turn it off or gate it for a tenant that doesn't
// want a fully public help center.

export interface KbPortalSettingsView {
  portalEnabled: boolean;
  hasAccessCode: boolean;
}

// portalEnabled defaults true with no row -- matches the portal's only-ever
// behavior before this setting existed, so an upgrading tenant with published
// articles doesn't silently lose its portal.
const DEFAULT_PORTAL_SETTINGS: KbPortalSettingsView = { portalEnabled: true, hasAccessCode: false };

export async function getKbPortalSettings(tenantId: string): Promise<KbPortalSettingsView> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const row = await tx.tenantKbSettings.findUnique({ where: { tenantId } });
    if (!row) return DEFAULT_PORTAL_SETTINGS;
    return { portalEnabled: row.portalEnabled, hasAccessCode: Boolean(row.hashedAccessCode) };
  });
}

export interface UpdateKbPortalSettingsInput {
  portalEnabled?: boolean;
  /** Plaintext -- only present when setting/replacing the code. `null` clears it (explicit act, same posture as clearing an AI provider key); `undefined` leaves whatever's stored alone. */
  accessCode?: string | null;
}

export async function updateKbPortalSettings(tenantId: string, input: UpdateKbPortalSettingsInput): Promise<KbPortalSettingsView> {
  const hashedAccessCode =
    input.accessCode === undefined ? undefined : input.accessCode === null ? null : await bcrypt.hash(input.accessCode, 12);

  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenantKbSettings.upsert({
      where: { tenantId },
      create: { tenantId, portalEnabled: input.portalEnabled ?? true, hashedAccessCode: hashedAccessCode ?? null },
      update: { portalEnabled: input.portalEnabled, hashedAccessCode },
    }),
  );
  return { portalEnabled: row.portalEnabled, hasAccessCode: Boolean(row.hashedAccessCode) };
}

export type KbPortalAccessResult = { ok: true } | { ok: false; reason: 'disabled' | 'code_required' | 'code_invalid' };

/** Checked by every /public/:tenantSlug/kb-* route before touching article data -- see routes.ts. */
export async function checkKbPortalAccess(tenantId: string, providedCode?: string): Promise<KbPortalAccessResult> {
  const row = await withTenantTx(prisma, tenantId, (tx) => tx.tenantKbSettings.findUnique({ where: { tenantId } }));
  if (row && !row.portalEnabled) return { ok: false, reason: 'disabled' };
  if (row?.hashedAccessCode) {
    if (!providedCode) return { ok: false, reason: 'code_required' };
    if (!(await bcrypt.compare(providedCode, row.hashedAccessCode))) return { ok: false, reason: 'code_invalid' };
  }
  return { ok: true };
}
