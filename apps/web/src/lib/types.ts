export type Permission = 'users:manage' | 'roles:manage' | 'tickets:read' | 'tickets:write' | 'tickets:manage_all';

export type TicketStatusCategory = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type MessageAuthorType = 'CONTACT' | 'AGENT' | 'SYSTEM' | 'AI';

export interface TicketStatus {
  id: string;
  key: string;
  label: string;
  category: TicketStatusCategory;
  sortOrder: number;
}

export interface Team {
  id: string;
  name: string;
}

export interface Contact {
  id: string;
  email: string;
  name: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: { key: string } | null;
}

export interface Message {
  id: string;
  ticketId: string;
  authorType: MessageAuthorType;
  authorUser: { id: string; name: string } | null;
  body: string;
  isPrivateNote: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  priority: TicketPriority;
  statusId: string;
  status: TicketStatus;
  teamId: string | null;
  team: Team | null;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  contactId: string;
  contact: Contact;
  channel: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface TicketDetail extends Ticket {
  messages: Message[];
}

export interface ApiKeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
