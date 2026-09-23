import { Worker } from 'bullmq';
import { TICKET_FOLLOWUP_QUEUE_NAME, type TicketFollowupJobPayload } from '@seredina/shared';
import { connection } from './queue';
import { finalizeWorkerCreatedTicket } from '../modules/tickets/service';
import { triageTicket } from '../modules/ai/triage';

/**
 * Follow-up work on a new ticket (docs/adr/0061-ai-triage.md). Consumed here,
 * in the api process, not in apps/worker: it needs the ticket service (SLA,
 * webhooks) and the AI adapter / bring-your-own-key / cost-logging code, which
 * all live here -- running it in the worker would mean duplicating them.
 * BullMQ hands each job to exactly one api replica.
 */
export async function processTicketFollowup(payload: TicketFollowupJobPayload): Promise<void> {
  if (payload.finalize) await finalizeWorkerCreatedTicket(payload.tenantId, payload.ticketId);
  try {
    await triageTicket(payload.tenantId, payload.ticketId);
  } catch (err) {
    // A failed suggestion is not worth retrying the finalize step for.
    console.error(`[ai-triage] ticket ${payload.ticketId} (tenant ${payload.tenantId}):`, err);
  }
}

/** Started by index.ts when running as the server -- never in tests, which call processTicketFollowup directly. */
export function startTicketFollowupWorker(): Worker<TicketFollowupJobPayload> {
  const worker = new Worker<TicketFollowupJobPayload>(TICKET_FOLLOWUP_QUEUE_NAME, (job) => processTicketFollowup(job.data), {
    connection,
    concurrency: 4,
  });
  worker.on('failed', (job, err) => console.error(`[ticket-followup] job ${job?.id} failed:`, err));
  return worker;
}
