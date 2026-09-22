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
  // Someone is composing on this ticket right now (docs/adr/0056-sla-countdown.md).
  | { type: 'ticket.typing'; ticketId: string; userId: string }
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

/** Every known type and the id fields it carries -- anything else on a message is dropped. */
const ID_KEYS: Record<LiveEventType, string[]> = {
  'ticket.created': ['ticketId'],
  'ticket.updated': ['ticketId'],
  'message.created': ['ticketId'],
  'sla.breached': ['ticketId'],
  'ticket.typing': ['ticketId', 'userId'],
  'notification.created': ['userId'],
};

/** Parses a message off the Redis channel; null for anything malformed rather than trusting it. */
export function parseLiveEvent(raw: string): LiveEvent | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value.type !== 'string' || !Object.hasOwn(ID_KEYS, value.type)) return null;
    const event: Record<string, string> = { type: value.type };
    for (const key of ID_KEYS[value.type as LiveEventType]) {
      if (typeof value[key] !== 'string') return null;
      event[key] = value[key] as string;
    }
    return event as unknown as LiveEvent;
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
