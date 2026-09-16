export type Permission =
  | 'users:manage'
  | 'roles:manage'
  | 'tickets:read'
  | 'tickets:write'
  | 'tickets:manage_all'
  | 'assets:read'
  | 'assets:manage'
  | 'channels:manage';

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

export interface Role {
  id: string;
  key: string;
  name: string;
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
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  customFields: Record<string, unknown> | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  resolutionDueAt: string | null;
}

export interface SlaPolicy {
  id: string;
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
}

export interface DayWindow {
  start: string;
  end: string;
}

export interface BusinessHoursSchedule {
  sun?: DayWindow[];
  mon?: DayWindow[];
  tue?: DayWindow[];
  wed?: DayWindow[];
  thu?: DayWindow[];
  fri?: DayWindow[];
  sat?: DayWindow[];
}

export interface BusinessHours {
  id: string;
  timezone: string;
  schedule: BusinessHoursSchedule;
}

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'SELECT';

export interface CustomFieldDefinition {
  id: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  required: boolean;
  sortOrder: number;
}

export type AssetType = 'SERVER' | 'WORKSTATION' | 'NETWORK_DEVICE' | 'PRINTER' | 'MOBILE_DEVICE' | 'OTHER';
export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'RETIRED';
export type AssetDiscoverySource = 'MANUAL' | 'AGENTLESS_SCAN';

export interface Asset {
  id: string;
  name: string;
  assetType: AssetType;
  status: AssetStatus;
  ipAddress: string | null;
  macAddress: string | null;
  hostname: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  discoverySource: AssetDiscoverySource;
  snmpSysDescr: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  modelId: string | null;
  catalogModel: AssetModel | null;
}

export interface Manufacturer {
  id: string;
  name: string;
}

export interface AssetModel {
  id: string;
  name: string;
  assetType: AssetType;
  manufacturer: Manufacturer;
}

export interface AssetSummary {
  id: string;
  name: string;
  ipAddress: string | null;
  assetType: AssetType;
}

export type DiscoveryJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface DiscoveryJob {
  id: string;
  cidrRange: string;
  status: DiscoveryJobStatus;
  discoveredCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TicketDetail extends Ticket {
  messages: Message[];
  assets: { assetId: string; asset: AssetSummary }[];
}

export interface ApiKeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface EmailChannel {
  id: string;
  name: string;
  fromAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  isActive: boolean;
  lastPolledAt: string | null;
  createdAt: string;
}

export interface MacroActions {
  setStatusId?: string;
  setPriority?: TicketPriority;
  setTeamId?: string | null;
  setAssigneeId?: string | null;
  addReply?: { body: string; isPrivateNote: boolean };
}

export interface Macro {
  id: string;
  name: string;
  actions: MacroActions;
  createdAt: string;
}

export type WebhookEvent = 'ticket.created' | 'ticket.updated' | 'message.created';

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: 'success' | 'failed' | null;
}

export type ProcessInstanceStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ProcessStepStatus = 'PENDING' | 'DONE' | 'APPROVED' | 'REJECTED' | 'SKIPPED';

export interface ProcessStepTemplate {
  id: string;
  label: string;
  sortOrder: number;
  requiresApproval: boolean;
  team: Team | null;
}

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string | null;
  steps: ProcessStepTemplate[];
}

export interface ProcessStepInstance {
  id: string;
  label: string;
  sortOrder: number;
  requiresApproval: boolean;
  status: ProcessStepStatus;
  assigneeId: string | null;
  assignee?: { id: string; name: string } | null;
  completedAt: string | null;
  ticketId: string | null;
  ticket?: { id: string; number: number; subject: string } | null;
}

export interface ProcessInstance {
  id: string;
  processTemplateId: string | null;
  templateName: string;
  subject: string;
  status: ProcessInstanceStatus;
  createdAt: string;
  completedAt: string | null;
  steps: ProcessStepInstance[];
}
