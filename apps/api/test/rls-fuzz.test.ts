import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { prisma, withTenantTx, type Prisma } from '@seredina/db';

/**
 * Automated RLS fuzz testing (Phase 4) -- see
 * docs/adr/0037-rls-fuzz-tests-and-ci.md. Complements, doesn't replace, the
 * hand-written isolation suites (tenant-isolation.test.ts,
 * asset-tenant-isolation.test.ts, ticket-tenant-isolation.test.ts), which
 * exist specifically to prove RLS itself blocks a leak even with the Prisma
 * Client Extension bypassed or disabled -- a structural guarantee that
 * applies uniformly to every table via the same policy-application loop in
 * prisma/rls/policies.sql, not something that needs re-proving per table.
 * What THIS suite adds is breadth: instead of 3 hand-picked tables, it
 * randomly exercises every tenant-scoped model simple enough to construct a
 * minimal valid row for with no dependency beyond tenantId itself (no other
 * required FK) -- so a newly added table that's wired into
 * TENANT_SCOPE_FIELD/policies.sql incorrectly, or forgotten from one of the
 * two, has a real chance of being caught here rather than only whenever a
 * human happens to write a dedicated test for that one table.
 *
 * **Deliberately excluded**: models needing another required FK beyond
 * tenantId (User, Ticket, Message, Attachment, ProcessInstance,
 * EscalationTier/Run, DashboardWidget, SavedView, NotificationPreference,
 * ServiceAsset, TicketAsset, DiscoveryJob, EmailChannel, AssetModel,
 * ProcessStepTemplate/Instance, AiAgentRun, AiUsageLog, KbChunk) -- building
 * a fully generic valid-fixture factory for every FK shape in the schema
 * was judged not worth it against the value of covering the ~18 simple
 * models for real; Ticket's own isolation is already covered by the
 * existing hand-written suite.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

interface FuzzModel {
  name: string;
  create: (tx: Prisma.TransactionClient, tenantId: string, seed: string) => Promise<{ id: string }>;
  findById: (tx: Prisma.TransactionClient, id: string) => Promise<unknown>;
}

const FUZZ_MODELS: FuzzModel[] = [
  {
    name: 'Team',
    create: (tx, tenantId, seed) => tx.team.create({ data: { tenantId, name: `team-${seed}` } }),
    findById: (tx, id) => tx.team.findUnique({ where: { id } }),
  },
  {
    name: 'Contact',
    create: (tx, tenantId, seed) => tx.contact.create({ data: { tenantId, email: `${seed}@example.com`, name: seed } }),
    findById: (tx, id) => tx.contact.findUnique({ where: { id } }),
  },
  {
    name: 'Webhook',
    create: (tx, tenantId, seed) =>
      tx.webhook.create({ data: { tenantId, url: `https://example.com/${seed}`, secretEncrypted: seed, events: ['ticket.created'] } }),
    findById: (tx, id) => tx.webhook.findUnique({ where: { id } }),
  },
  {
    name: 'Macro',
    create: (tx, tenantId, seed) => tx.macro.create({ data: { tenantId, name: `macro-${seed}`, actions: {} } }),
    findById: (tx, id) => tx.macro.findUnique({ where: { id } }),
  },
  {
    name: 'SlaPolicy',
    create: (tx, tenantId) => tx.slaPolicy.create({ data: { tenantId, priority: 'NORMAL', firstResponseMinutes: 60, resolutionMinutes: 480 } }),
    findById: (tx, id) => tx.slaPolicy.findUnique({ where: { id } }),
  },
  {
    name: 'BusinessHours',
    create: (tx, tenantId) => tx.businessHours.create({ data: { tenantId, timezone: 'UTC', schedule: {} } }),
    findById: (tx, id) => tx.businessHours.findUnique({ where: { id } }),
  },
  {
    name: 'KbArticle',
    create: (tx, tenantId, seed) => tx.kbArticle.create({ data: { tenantId, title: seed, slug: seed, body: 'body' } }),
    findById: (tx, id) => tx.kbArticle.findUnique({ where: { id } }),
  },
  {
    name: 'OnCallSchedule',
    create: (tx, tenantId, seed) => tx.onCallSchedule.create({ data: { tenantId, name: `oncall-${seed}` } }),
    findById: (tx, id) => tx.onCallSchedule.findUnique({ where: { id } }),
  },
  {
    name: 'CustomFieldDefinition',
    create: (tx, tenantId, seed) => tx.customFieldDefinition.create({ data: { tenantId, key: seed, label: seed, fieldType: 'TEXT' } }),
    findById: (tx, id) => tx.customFieldDefinition.findUnique({ where: { id } }),
  },
  {
    name: 'Manufacturer',
    create: (tx, tenantId, seed) => tx.manufacturer.create({ data: { tenantId, name: `mfr-${seed}` } }),
    findById: (tx, id) => tx.manufacturer.findUnique({ where: { id } }),
  },
  {
    name: 'AutonomyPolicy',
    create: (tx, tenantId) => tx.autonomyPolicy.create({ data: { tenantId, autoExecuteTools: [] } }),
    findById: (tx, id) => tx.autonomyPolicy.findUnique({ where: { id } }),
  },
  {
    name: 'TenantAiSettings',
    create: (tx, tenantId) => tx.tenantAiSettings.create({ data: { tenantId } }),
    findById: (tx, id) => tx.tenantAiSettings.findUnique({ where: { id } }),
  },
  {
    name: 'ApiKey',
    create: (tx, tenantId, seed) => tx.apiKey.create({ data: { tenantId, name: seed, hashedKey: seed } }),
    findById: (tx, id) => tx.apiKey.findUnique({ where: { id } }),
  },
  {
    name: 'TicketStatus',
    create: (tx, tenantId, seed) => tx.ticketStatus.create({ data: { tenantId, key: seed, label: seed, category: 'OPEN' } }),
    findById: (tx, id) => tx.ticketStatus.findUnique({ where: { id } }),
  },
  {
    name: 'Role',
    create: (tx, tenantId, seed) => tx.role.create({ data: { tenantId, key: seed, name: seed } }),
    findById: (tx, id) => tx.role.findUnique({ where: { id } }),
  },
  {
    name: 'ServiceCatalogItem',
    create: (tx, tenantId, seed) => tx.serviceCatalogItem.create({ data: { tenantId, name: seed } }),
    findById: (tx, id) => tx.serviceCatalogItem.findUnique({ where: { id } }),
  },
  {
    name: 'Service',
    create: (tx, tenantId, seed) => tx.service.create({ data: { tenantId, name: seed } }),
    findById: (tx, id) => tx.service.findUnique({ where: { id } }),
  },
  {
    name: 'ProcessTemplate',
    create: (tx, tenantId, seed) => tx.processTemplate.create({ data: { tenantId, name: seed } }),
    findById: (tx, id) => tx.processTemplate.findUnique({ where: { id } }),
  },
];

describe.skipIf(!hasDb)('RLS fuzz: cross-tenant isolation across every simple tenant-scoped model', () => {
  it(
    `never leaks a row to a different tenant, across ${FUZZ_MODELS.length} models and randomized runs`,
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...FUZZ_MODELS), async (model) => {
          const tenantA = randomUUID();
          const tenantB = randomUUID();
          const seed = randomUUID().replace(/-/g, '').slice(0, 16);

          await withTenantTx(prisma, tenantA, (tx) =>
            tx.tenant.create({ data: { id: tenantA, slug: `fuzz-a-${tenantA.slice(0, 8)}`, name: 'Fuzz Tenant A' } }),
          );
          await withTenantTx(prisma, tenantB, (tx) =>
            tx.tenant.create({ data: { id: tenantB, slug: `fuzz-b-${tenantB.slice(0, 8)}`, name: 'Fuzz Tenant B' } }),
          );

          const created = await withTenantTx(prisma, tenantA, (tx) => model.create(tx, tenantA, seed));

          // Sanity check first -- if this fails, the fixture itself is broken,
          // not the isolation the test actually cares about.
          const readAsOwner = await withTenantTx(prisma, tenantA, (tx) => model.findById(tx, created.id));
          if (readAsOwner === null) {
            throw new Error(`${model.name}: fixture didn't even read back for its own tenant -- broken fixture, not an isolation failure`);
          }

          // The actual property under test.
          const readAsOtherTenant = await withTenantTx(prisma, tenantB, (tx) => model.findById(tx, created.id));
          expect(readAsOtherTenant, `${model.name} leaked a row across tenants`).toBeNull();
        }),
        { numRuns: 40 },
      );
    },
    120_000,
  );
});
