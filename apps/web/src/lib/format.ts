import type { BadgeTone } from '../components/Badge';
import type { TicketPriority, TicketStatusCategory } from './types';

export const STATUS_CATEGORY_TONE: Record<TicketStatusCategory, BadgeTone> = {
  OPEN: 'blue',
  PENDING: 'amber',
  RESOLVED: 'green',
  CLOSED: 'slate',
};

export const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  LOW: 'slate',
  NORMAL: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
