import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { TestProviderAdapter } from '@seredina/ai-adapters';
import { createKbArticle } from '../src/modules/kb/service';
import { searchKnowledgeBase } from '../src/modules/kb/embeddings';
import { addMessage, createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { suggestReply } from '../src/modules/ai/service';
// apps/worker has no test infra of its own and apps/api never imports apps/worker
// code in production paths -- this cross-import is test-only, to populate real
// KbChunk rows synchronously instead of standing up a BullMQ worker in-test.
// See docs/adr/0032-rag-knowledge-base-search.md.
import { embedKbArticle } from '../../worker/src/kb/embed';

/**
 * Exercises the actual RAG pipeline end-to-end against live Postgres: real local
 * embeddings (no API cost, no network), real pgvector cosine search, real RLS-scoped
 * raw SQL. Skipped entirely without a live DB, same convention as the other
 * live-Postgres suites.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('RAG knowledge base search', () => {
  let tenantAId: string;
  let tenantBId: string;
  let vpnArticleId: string;
  let printerArticleId: string;

  beforeAll(async () => {
    tenantAId = randomUUID();
    tenantBId = randomUUID();
    await withTenantTx(prisma, tenantAId, (tx) =>
      tx.tenant.create({ data: { id: tenantAId, slug: `rag-a-${tenantAId.slice(0, 8)}`, name: 'RAG Tenant A' } }),
    );
    await withTenantTx(prisma, tenantBId, (tx) =>
      tx.tenant.create({ data: { id: tenantBId, slug: `rag-b-${tenantBId.slice(0, 8)}`, name: 'RAG Tenant B' } }),
    );

    const vpnArticle = await createKbArticle(tenantAId, {
      title: 'VPN Setup Guide',
      body: 'To connect to the corporate VPN, open the VPN client, enter your company credentials, and click Connect. If the connection drops repeatedly, update the client to the latest version.',
      published: true,
    });
    vpnArticleId = vpnArticle.id;

    const printerArticle = await createKbArticle(tenantAId, {
      title: 'Printer Troubleshooting',
      body: 'If the office printer shows a paper jam error, open the rear tray and gently remove any stuck paper, then close the tray and press the reset button.',
      published: true,
    });
    printerArticleId = printerArticle.id;

    const tenantBArticle = await createKbArticle(tenantBId, {
      title: 'VPN Access for Tenant B',
      body: 'Tenant B VPN access requires a hardware token. Contact IT to receive one before attempting to connect.',
      published: true,
    });

    // Populate KbChunk rows synchronously rather than waiting on the real queue
    // consumer (no worker process runs in this test suite).
    await embedKbArticle(tenantAId, vpnArticleId);
    await embedKbArticle(tenantAId, printerArticleId);
    await embedKbArticle(tenantBId, tenantBArticle.id);
  }, 60_000);

  it('ranks the topically relevant article above an unrelated one', async () => {
    const results = await searchKnowledgeBase(tenantAId, 'my VPN connection keeps disconnecting', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kbArticleId).toBe(vpnArticleId);

    const printerResult = results.find((r) => r.kbArticleId === printerArticleId);
    if (printerResult) {
      expect(results[0].similarity).toBeGreaterThan(printerResult.similarity);
    }
  }, 30_000);

  it('never returns another tenant chunks, even for an identical query', async () => {
    const results = await searchKnowledgeBase(tenantAId, 'VPN access hardware token', 10);
    expect(results.every((r) => r.kbArticleId !== undefined)).toBe(true);
    expect(results.some((r) => r.title === 'VPN Access for Tenant B')).toBe(false);
  }, 30_000);

  it('returns an empty array for a tenant with no chunks', async () => {
    const emptyTenantId = randomUUID();
    await withTenantTx(prisma, emptyTenantId, (tx) =>
      tx.tenant.create({ data: { id: emptyTenantId, slug: `rag-empty-${emptyTenantId.slice(0, 8)}`, name: 'Empty Tenant' } }),
    );
    const results = await searchKnowledgeBase(emptyTenantId, 'anything at all', 5);
    expect(results).toEqual([]);
  }, 30_000);

  describe('suggestReply RAG grounding', () => {
    it('grounds the suggestion with a matching article and reports it in usedArticles', async () => {
      await withTenantTx(prisma, tenantAId, (tx) => seedDefaultTicketStatuses(tx, tenantAId));

      const ticket = await createTicketFromApi(tenantAId, {
        subject: 'VPN disconnects constantly',
        body: 'My VPN connection drops every few minutes and I have to reconnect.',
        contactEmail: 'vpn-customer@example.com',
        contactName: 'VPN Customer',
      });

      const adapter = new TestProviderAdapter(['Please update your VPN client to the latest version.']);
      const result = await suggestReply(tenantAId, ticket.id, adapter);

      expect(result.usedArticles.length).toBeGreaterThan(0);
      expect(result.usedArticles.some((a) => a.id === vpnArticleId)).toBe(true);

      const [call] = adapter.getCalls();
      expect(call.system).toContain('VPN Setup Guide');
    }, 30_000);

    it('degrades gracefully with no grounding when nothing is similar enough', async () => {
      const emptyTenantId = randomUUID();
      await withTenantTx(prisma, emptyTenantId, async (tx) => {
        await tx.tenant.create({
          data: { id: emptyTenantId, slug: `rag-nogr-${emptyTenantId.slice(0, 8)}`, name: 'No Grounding Tenant' },
        });
        await seedDefaultTicketStatuses(tx, emptyTenantId);
      });

      const ticket = await createTicketFromApi(emptyTenantId, {
        subject: 'Completely unrelated request',
        body: 'What is the meaning of life?',
        contactEmail: 'philosopher@example.com',
        contactName: 'Philosopher',
      });

      const adapter = new TestProviderAdapter(['I am not sure, let me look into it.']);
      const result = await suggestReply(emptyTenantId, ticket.id, adapter);

      expect(result.usedArticles).toEqual([]);
      const [call] = adapter.getCalls();
      expect(call.system).not.toContain('Relevant internal knowledge base excerpts');
    }, 30_000);
  });
});
