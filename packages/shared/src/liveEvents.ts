// Live console updates (docs/adr/0053-live-updates.md). apps/api and
// apps/worker PUBLISH these on Redis after a change commits; apps/api's
// GET /events relays them to connected consoles over Server-Sent Events.
//
// Events are invalidations, not data: they carry ids only, never a ticket's
// subject or a message's body. A console that receives one refetches through
// the normal REST API, which applies the viewer's permissions -- so the
// stream can't leak a private note or anything else the viewer couldn't
// already read.

export type LiveEvent =
  | { type: 'ticket.created'; ticketId: string }
  | { type: 'ticket.updated'; ticketId: string }
  | { type: 'message.created'; ticketId: string }
  | { type: 'sla.breached'; ticketId: string }
  // Only ever delivered to that one user's own streams.
  | { type: 'notification.created'; userId: string };

export type LiveEventType = LiveEvent['type'];

const CHANNEL_PREFIX = 'seredina:live:';

/** One channel per tenant, so a subscriber can never be handed another tenant's events by a routing slip. */
export function liveChannel(tenantId: string): string {
  return `${CHANNEL_PREFIX}${tenantId}`;
}

export const LIVE_CHANNEL_PATTERN = `${CHANNEL_PREFIX}*`;

export function tenantIdFromLiveChannel(channel: string): string | null {
  return channel.startsWith(CHANNEL_PREFIX) ? channel.slice(CHANNEL_PREFIX.length) : null;
}

const LIVE_EVENT_TYPES: ReadonlySet<string> = new Set<LiveEventType>([
  'ticket.created',
  'ticket.updated',
  'message.created',
  'sla.breached',
  'notification.created',
]);

/** Parses a message off the Redis channel; null for anything malformed rather than trusting it. */
export function parseLiveEvent(raw: string): LiveEvent | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value.type !== 'string' || !LIVE_EVENT_TYPES.has(value.type)) return null;
    const idKey = value.type === 'notification.created' ? 'userId' : 'ticketId';
    if (typeof value[idKey] !== 'string') return null;
    return { type: value.type, [idKey]: value[idKey] } as LiveEvent;
  } catch {
    return null;
  }
}

/** Any client with a Redis-style publish -- apps/api and apps/worker each pass their own ioredis connection. */
export interface LivePublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/**
 * Best-effort by design: a live update is a convenience on top of data that
 * is already committed, so a Redis hiccup must never fail the request or job
 * that made the change. Consoles reconcile on their next refetch anyway.
 */
export async function publishLiveEvent(publisher: LivePublisher, tenantId: string, event: LiveEvent): Promise<void> {
  try {
    await publisher.publish(liveChannel(tenantId), JSON.stringify(event));
  } catch (err) {
    console.warn(`live event ${event.type} not published: ${(err as Error).message}`);
  }
}
