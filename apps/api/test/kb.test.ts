import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  createKbArticle,
  deleteKbArticle,
  getKbArticle,
  getPublishedKbArticleBySlug,
  listKbArticles,
  listPublishedKbArticles,
  updateKbArticle,
} from '../src/modules/kb/service';
import { resolveTenantIdBySlug } from '../src/modules/tenants/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Knowledge Base', () => {
  let tenantId: string;
  let tenantSlug: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    tenantSlug = `kb-${tenantId.slice(0, 8)}`;
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'KB Test' } }),
    );
  });

  it('creates an article as an unpublished draft by default, with a slug derived from the title', async () => {
    const article = await createKbArticle(tenantId, { title: 'How to Reset Your Password', body: 'Step one...' });
    expect(article.published).toBe(false);
    expect(article.slug).toBe('how-to-reset-your-password');
  });

  it('dedupes slugs for a repeated title rather than colliding', async () => {
    const first = await createKbArticle(tenantId, { title: 'VPN Setup', body: 'v1' });
    const second = await createKbArticle(tenantId, { title: 'VPN Setup', body: 'v2' });
    expect(first.slug).toBe('vpn-setup');
    expect(second.slug).toBe('vpn-setup-2');
  });

  it('a title change never changes the already-assigned slug', async () => {
    const article = await createKbArticle(tenantId, { title: 'Printer Troubleshooting', body: 'body' });
    const updated = await updateKbArticle(tenantId, article.id, { title: 'Printer Troubleshooting (Updated)' });
    expect(updated.slug).toBe(article.slug);
    expect(updated.title).toBe('Printer Troubleshooting (Updated)');
  });

  it('search matches title or body, case-insensitively', async () => {
    await createKbArticle(tenantId, { title: 'Wildly Unrelated Title', body: 'Mentions Kubernetes somewhere in here.' });
    const byTitle = await listKbArticles(tenantId, 'unrelated');
    const byBody = await listKbArticles(tenantId, 'KUBERNETES');
    expect(byTitle.articles.map((a) => a.title)).toContain('Wildly Unrelated Title');
    expect(byBody.articles.map((a) => a.title)).toContain('Wildly Unrelated Title');
  });

  it('the public routes never return an unpublished draft, by list or by slug', async () => {
    const draft = await createKbArticle(tenantId, { title: 'Draft Only', body: 'not ready yet', published: false });
    const published = await createKbArticle(tenantId, { title: 'Published Article', body: 'ready', published: true });

    const publicList = await listPublishedKbArticles(tenantId);
    expect(publicList.map((a) => a.id)).toContain(published.id);
    expect(publicList.map((a) => a.id)).not.toContain(draft.id);

    await expect(getPublishedKbArticleBySlug(tenantId, draft.slug)).rejects.toThrow('article not found');
    const fetched = await getPublishedKbArticleBySlug(tenantId, published.slug);
    expect(fetched.title).toBe('Published Article');
  });

  it('publishing toggles an article into the public list without changing its slug', async () => {
    const article = await createKbArticle(tenantId, { title: 'Initially Draft', body: 'body' });
    expect(await listPublishedKbArticles(tenantId).then((l) => l.map((a) => a.id))).not.toContain(article.id);

    const published = await updateKbArticle(tenantId, article.id, { published: true });
    expect(published.slug).toBe(article.slug);
    expect(await listPublishedKbArticles(tenantId).then((l) => l.map((a) => a.id))).toContain(article.id);
  });

  it('resolveTenantIdBySlug finds this tenant by its slug -- the mechanism the public portal routes depend on', async () => {
    const resolved = await resolveTenantIdBySlug(tenantSlug);
    expect(resolved).toBe(tenantId);
    expect(await resolveTenantIdBySlug('no-such-tenant-slug-at-all')).toBeNull();
  });

  it('deletes an article and rejects deleting one that does not exist', async () => {
    const article = await createKbArticle(tenantId, { title: 'Temporary Article', body: 'body' });
    await deleteKbArticle(tenantId, article.id);
    await expect(getKbArticle(tenantId, article.id)).rejects.toThrow('article not found');
    await expect(deleteKbArticle(tenantId, article.id)).rejects.toThrow('article not found');
  });
});
