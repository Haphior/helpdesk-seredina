import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, listTickets, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { createProblem, listProblems, updateProblem } from '../src/modules/problems/service';
import { createProcessTemplate, listProcessInstances, startProcessInstance } from '../src/modules/processes/service';
import { createAttachment, getAttachment, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_SIZE_BYTES } from '../src/modules/attachments/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Work section improvements (review pass)', () => {
  let tenantId: string;
  let otherTenantId: string;
  let ownerId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `wsi-${tenantId.slice(0, 8)}`, name: 'Work Section Improvements' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      const owner = await tx.user.create({ data: { tenantId, email: 'owner@example.com', name: 'Root Cause Owner', passwordHash: 'x' } });
      ownerId = owner.id;
    });
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `wsi-other-${otherTenantId.slice(0, 8)}`, name: 'Other' } });
      await seedDefaultTicketStatuses(tx, otherTenantId);
    });
  });

  describe('ticket search + pagination', () => {
    it('q matches subject or contact name/email, case-insensitively', async () => {
      await createTicketFromApi(tenantId, {
        subject: 'Printer jammed in accounting',
        body: 'b',
        contactEmail: 'jane.roe@example.com',
        contactName: 'Jane Roe',
      });
      await createTicketFromApi(tenantId, { subject: 'VPN drops', body: 'b', contactEmail: 'other@example.com', contactName: 'Someone Else' });

      const bySubject = await listTickets(tenantId, { q: 'PRINTER' });
      expect(bySubject.tickets.some((t) => t.subject === 'Printer jammed in accounting')).toBe(true);
      expect(bySubject.tickets.some((t) => t.subject === 'VPN drops')).toBe(false);

      const byContactName = await listTickets(tenantId, { q: 'jane roe' });
      expect(byContactName.tickets.some((t) => t.subject === 'Printer jammed in accounting')).toBe(true);

      const byContactEmail = await listTickets(tenantId, { q: 'jane.roe@example.com' });
      expect(byContactEmail.tickets.some((t) => t.subject === 'Printer jammed in accounting')).toBe(true);
    });

    it('limit/offset page through results and total reflects the full matching count, not just the page', async () => {
      const freshTenantId = randomUUID();
      await withTenantTx(prisma, freshTenantId, async (tx) => {
        await tx.tenant.create({ data: { id: freshTenantId, slug: `wsi-page-${freshTenantId.slice(0, 8)}`, name: 'Paging' } });
        await seedDefaultTicketStatuses(tx, freshTenantId);
      });
      for (let i = 0; i < 5; i++) {
        await createTicketFromApi(freshTenantId, { subject: `Ticket ${i}`, body: 'b', contactEmail: 'c@example.com', contactName: 'C' });
      }

      const page1 = await listTickets(freshTenantId, { limit: 2, offset: 0 });
      const page2 = await listTickets(freshTenantId, { limit: 2, offset: 2 });
      expect(page1.tickets).toHaveLength(2);
      expect(page2.tickets).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
      expect(page1.tickets.map((t) => t.id)).not.toEqual(page2.tickets.map((t) => t.id));
    });
  });

  describe('agent-created ("blank") ticket', () => {
    it('createTicketFromApi with channel "agent" produces a real, correctly-channeled ticket', async () => {
      const ticket = await createTicketFromApi(tenantId, {
        subject: 'Walk-in: new hire needs a laptop',
        body: 'Requested in person at the front desk',
        contactEmail: 'newhire@example.com',
        contactName: 'New Hire',
        channel: 'agent',
      });
      expect(ticket.channel).toBe('agent');
    });
  });

  describe('problem owner + status filter + pagination', () => {
    it('createProblem/updateProblem accept and return an owner', async () => {
      const problem = await createProblem(tenantId, { title: 'Recurring VPN drops', ownerId });
      expect(problem.owner?.id).toBe(ownerId);

      const unassigned = await updateProblem(tenantId, problem.id, { ownerId: null });
      expect(unassigned.owner).toBeNull();
    });

    it('listProblems filters by status and paginates', async () => {
      const freshTenantId = randomUUID();
      await withTenantTx(prisma, freshTenantId, async (tx) => {
        await tx.tenant.create({ data: { id: freshTenantId, slug: `wsi-probs-${freshTenantId.slice(0, 8)}`, name: 'Probs' } });
      });
      const p1 = await createProblem(freshTenantId, { title: 'Open one' });
      const p2 = await createProblem(freshTenantId, { title: 'Closed one' });
      await updateProblem(freshTenantId, p2.id, { status: 'CLOSED' });

      const closedOnly = await listProblems(freshTenantId, { status: 'CLOSED' });
      expect(closedOnly.problems.map((p) => p.id)).toEqual([p2.id]);
      expect(closedOnly.total).toBe(1);

      const all = await listProblems(freshTenantId, { limit: 1 });
      expect(all.problems).toHaveLength(1);
      expect(all.total).toBe(2);
      void p1;
    });
  });

  describe('process instance status filter + pagination', () => {
    it('listProcessInstances filters by status and paginates', async () => {
      const template = await createProcessTemplate(tenantId, {
        name: `Onboarding-${randomUUID().slice(0, 8)}`,
        steps: [{ label: 'Step 1' }],
      });
      const inst1 = await startProcessInstance(tenantId, template.id, 'Onboard A', {});
      const inst2 = await startProcessInstance(tenantId, template.id, 'Onboard B', {});
      await withTenantTx(prisma, tenantId, (tx) => tx.processInstance.update({ where: { id: inst2.id }, data: { status: 'CANCELLED' } }));

      const cancelledOnly = await listProcessInstances(tenantId, { status: 'CANCELLED' });
      expect(cancelledOnly.instances.map((i) => i.id)).toContain(inst2.id);
      expect(cancelledOnly.instances.map((i) => i.id)).not.toContain(inst1.id);
    });
  });

  describe('attachments', () => {
    it('creates and reads back a real attachment, tied to its message', async () => {
      const ticket = await createTicketFromApi(tenantId, {
        subject: 'Ticket needing a screenshot',
        body: 'b',
        contactEmail: 'c@example.com',
        contactName: 'C',
      });
      const message = await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'SYSTEM', body: 'x', isPrivateNote: false } }),
      );

      const data = Buffer.from('fake png bytes');
      const attachment = await createAttachment(tenantId, message.id, { filename: 'screenshot.png', mimeType: 'image/png', data });
      expect(attachment.filename).toBe('screenshot.png');
      expect(attachment.sizeBytes).toBe(data.byteLength);

      const fetched = await getAttachment(tenantId, attachment.id);
      expect(fetched.data.toString()).toBe('fake png bytes');
    });

    it('rejects a file over the size cap', async () => {
      const ticket = await createTicketFromApi(tenantId, { subject: 'x', body: 'b', contactEmail: 'c@example.com', contactName: 'C' });
      const message = await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'SYSTEM', body: 'x', isPrivateNote: false } }),
      );
      const oversized = Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1);
      await expect(createAttachment(tenantId, message.id, { filename: 'big.bin', mimeType: 'application/octet-stream', data: oversized })).rejects.toThrow(
        /exceeds the/,
      );
    });

    it('rejects a 6th attachment on the same message', async () => {
      const ticket = await createTicketFromApi(tenantId, { subject: 'x', body: 'b', contactEmail: 'c@example.com', contactName: 'C' });
      const message = await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'SYSTEM', body: 'x', isPrivateNote: false } }),
      );
      for (let i = 0; i < MAX_ATTACHMENTS_PER_MESSAGE; i++) {
        await createAttachment(tenantId, message.id, { filename: `f${i}.txt`, mimeType: 'text/plain', data: Buffer.from('x') });
      }
      await expect(
        createAttachment(tenantId, message.id, { filename: 'one-too-many.txt', mimeType: 'text/plain', data: Buffer.from('x') }),
      ).rejects.toThrow(/at most/);
    });

    it('never lets a second tenant read the first tenant\'s attachment', async () => {
      const ticket = await createTicketFromApi(tenantId, { subject: 'x', body: 'b', contactEmail: 'c@example.com', contactName: 'C' });
      const message = await withTenantTx(prisma, tenantId, (tx) =>
        tx.message.create({ data: { tenantId, ticketId: ticket.id, authorType: 'SYSTEM', body: 'x', isPrivateNote: false } }),
      );
      const attachment = await createAttachment(tenantId, message.id, { filename: 'secret.txt', mimeType: 'text/plain', data: Buffer.from('x') });
      await expect(getAttachment(otherTenantId, attachment.id)).rejects.toThrow('attachment not found');
    });
  });
});
