import type { BadgeTone } from '../components/Badge';
import type { TicketPriority, TicketStatusCategory } from './types';

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

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
