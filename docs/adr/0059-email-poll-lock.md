# ADR 0059: Email polling across several worker replicas

## Status

Accepted, implemented. Resolves the known limitation in ADR 0004 and
ADR 0038.

## Context

The worker polls every connected mailbox on an interval loop. Each worker
process ran that loop over the full channel list, so two `worker` replicas
logged in to every mailbox at the same time. Both fetched the same unread
messages before either marked them `\Seen`, which created every ticket twice.
This is the one piece of worker state that stopped `worker` from being
scaled horizontally.

## Decision

Two independent guards.

1. **A per-mailbox Redis lock.** Before polling a channel, a replica takes
   `seredina:email-poll:{channelId}` with `SET NX PX` (5-minute TTL) and
   releases it with a compare-and-delete script. A replica that finds the key
   held skips that mailbox for this cycle. The lock is per channel, not one
   global lock, so replicas share the work instead of idling behind one
   leader. The TTL only matters if a replica dies mid-poll.
   (`apps/worker/src/lib/lock.ts`)
2. **Idempotent ingestion on Message-ID.** `ingestInboundEmail` returns the
   existing ticket when a customer message with the same `Message-ID` is
   already stored. This also covers the case the lock can't: a replica that
   ingests a message, then dies before flagging it `\Seen`, so the next poll
   sees it again.

The existing BullMQ workers (sending, webhooks, SLA timers and the rest)
were already safe across replicas; BullMQ hands each job to one worker.

## Consequences

- `worker` can run as several replicas.
- A single mailbox is still polled by one process at a time, which is what
  IMAP wants anyway.
- A message without a `Message-ID` gets a generated id based on the channel
  and UID. It's deduplicated as long as the UID doesn't change, which holds
  for the same mailbox.
