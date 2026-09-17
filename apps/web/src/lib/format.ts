import type { BadgeTone } from '../components/Badge';
import type { ChangeRiskLevel, ProblemStatus, Ticket, TicketPriority, TicketStatusCategory } from './types';

export const STATUS_CATEGORY_TONE: Record<TicketStatusCategory, BadgeTone> = {
  OPEN: 'sky',
  PENDING: 'amber',
  RESOLVED: 'emerald',
  CLOSED: 'slate',
};

export const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  LOW: 'slate',
  NORMAL: 'indigo',
  HIGH: 'orange',
  URGENT: 'rose',
};

export const RISK_TONE: Record<ChangeRiskLevel, BadgeTone> = {
  LOW: 'slate',
  MEDIUM: 'orange',
  HIGH: 'rose',
};

export const PROBLEM_STATUS_TONE: Record<ProblemStatus, BadgeTone> = {
  UNDER_INVESTIGATION: 'amber',
  KNOWN_ERROR: 'orange',
  RESOLVED: 'emerald',
  CLOSED: 'slate',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// A milestone is overdue when its due-at has passed and the matching "met"
// timestamp is still null -- computed here at read time rather than stored as a
// boolean, so it's always accurate even if the worker's delayed breach-check job
// hasn't fired yet (that job only decides whether to notify a webhook; it never
// gates what the UI shows).
export function isFirstResponseOverdue(ticket: Ticket): boolean {
  return !ticket.firstRespondedAt && !!ticket.firstResponseDueAt && new Date(ticket.firstResponseDueAt) < new Date();
}

export function isResolutionOverdue(ticket: Ticket): boolean {
  return !ticket.resolvedAt && !ticket.closedAt && !!ticket.resolutionDueAt && new Date(ticket.resolutionDueAt) < new Date();
}

export function isTicketOverdue(ticket: Ticket): boolean {
  return isFirstResponseOverdue(ticket) || isResolutionOverdue(ticket);
}
