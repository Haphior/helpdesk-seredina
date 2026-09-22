import { describe, expect, it } from 'vitest';
import { liveChannel, parseLiveEvent, publishLiveEvent, tenantIdFromLiveChannel } from './liveEvents';

describe('parseLiveEvent', () => {
  it('keeps only the type and its id, dropping anything else a publisher attached', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'ticket.updated', ticketId: 't1', subject: 'secret', body: 'secret' }))).toEqual({
      type: 'ticket.updated',
      ticketId: 't1',
    });
    expect(parseLiveEvent(JSON.stringify({ type: 'notification.created', userId: 'u1', ticketId: 't1' }))).toEqual({
      type: 'notification.created',
      userId: 'u1',
    });
  });

  it('keeps both ids of a typing event, and nothing else', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'ticket.typing', ticketId: 't1', userId: 'u1', body: 'draft text' }))).toEqual({
      type: 'ticket.typing',
      ticketId: 't1',
      userId: 'u1',
    });
    expect(parseLiveEvent(JSON.stringify({ type: 'ticket.typing', ticketId: 't1' }))).toBeNull();
  });

  it('rejects unknown types, missing ids, and non-JSON', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'admin.pwned', ticketId: 't1' }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: 'ticket.updated' }))).toBeNull();
    expect(parseLiveEvent(JSON.stringify({ type: 'notification.created', ticketId: 't1' }))).toBeNull();
    expect(parseLiveEvent('not json')).toBeNull();
    expect(parseLiveEvent('null')).toBeNull();
  });
});

describe('live channels', () => {
  it('round-trips a tenant id and ignores foreign channels', () => {
    expect(tenantIdFromLiveChannel(liveChannel('abc'))).toBe('abc');
    expect(tenantIdFromLiveChannel('bull:queue:abc')).toBeNull();
  });
});

describe('publishLiveEvent', () => {
  it('never throws when Redis is unavailable', async () => {
    const failing = { publish: () => Promise.reject(new Error('ECONNREFUSED')) };
    await expect(publishLiveEvent(failing, 't', { type: 'ticket.created', ticketId: 'x' })).resolves.toBeUndefined();
  });

  it('publishes on the tenant channel', async () => {
    const calls: [string, string][] = [];
    await publishLiveEvent({ publish: async (c, m) => void calls.push([c, m]) }, 'tenant-1', { type: 'sla.breached', ticketId: 'x' });
    expect(calls).toEqual([[liveChannel('tenant-1'), JSON.stringify({ type: 'sla.breached', ticketId: 'x' })]]);
  });
});
