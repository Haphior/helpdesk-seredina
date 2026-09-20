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
  isActive: boolean;
  isLocked: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  permissions: Permission[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Message {
  id: string;
  ticketId: string;
  authorType: MessageAuthorType;
  authorUser: { id: string; name: string } | null;
  body: string;
  isPrivateNote: boolean;
  createdAt: string;
  attachments: Attachment[];
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
  problemId: string | null;
  mergedIntoId: string | null;
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
  services?: { id: string; name: string }[];
}

export interface AssetDetail extends Asset {
  tickets: { ticket: { id: string; number: number; subject: string } }[];
  services: { id: string; name: string }[];
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
  problem?: { id: string; number: number; title: string } | null;
  mergedInto?: { id: string; number: number; subject: string } | null;
  mergedTickets?: { id: string; number: number; subject: string }[];
  escalation?: EscalationRun | null;
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

export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'message.created'
  | 'sla.first_response_breached'
  | 'sla.resolution_breached';

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

export type ProcessTemplateKind = 'GENERAL' | 'CHANGE' | 'RELEASE';
export type ChangeRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string | null;
  kind: ProcessTemplateKind;
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
  riskLevel: ChangeRiskLevel | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  rollbackPlan: string | null;
  releaseVersion: string | null;
  changeInstanceId: string | null;
  changeInstance?: { id: string; subject: string } | null;
}

export type WidgetType =
  | 'onboarding_checklist'
  | 'ticket_volume'
  | 'priority_breakdown'
  | 'sla_compliance'
  | 'csat_score'
  | 'agent_workload'
  | 'recent_activity';

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

export interface OnboardingChecklist {
  items: OnboardingChecklistItem[];
  allDone: boolean;
}

export interface DashboardPref {
  widgetType: WidgetType;
  visible: boolean;
  sortOrder: number;
}

export interface TicketVolumePoint {
  date: string;
  count: number;
}

export interface SlaComplianceReport {
  met: number;
  breached: number;
  total: number;
  percentMet: number | null;
}

export interface AgentWorkloadReport {
  agents: { userId: string; name: string; count: number }[];
  unassigned: number;
}

export interface CsatSummary {
  total: number;
  average: number | null;
  distribution: Record<number, number>;
}

export interface CsatSurvey {
  ticketNumber: number;
  ticketSubject: string;
  rating: number | null;
  comment: string | null;
  respondedAt: string | null;
}

export type ProblemStatus = 'UNDER_INVESTIGATION' | 'KNOWN_ERROR' | 'RESOLVED' | 'CLOSED';

export interface ProblemTicketSummary {
  id: string;
  number: number;
  subject: string;
  statusId: string;
}

export interface Problem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: ProblemStatus;
  rootCause: string | null;
  workaround: string | null;
  changeInstanceId: string | null;
  changeInstance?: { id: string; subject: string } | null;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  tickets: ProblemTicketSummary[];
}

export interface ServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  customFieldKeys: string[];
  sortOrder: number;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  assets: { asset: AssetSummary }[];
}

export interface KbArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  published: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantBranding {
  logoUrl: string | null;
  accentColor: string | null;
}

export interface PublicKbArticleSummary {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
}

export interface PublicKbArticle {
  id: string;
  title: string;
  slug: string;
  body: string;
  updatedAt: string;
}

export interface OnCallShift {
  id: string;
  startsAt: string;
  endsAt: string;
  user: { id: string; name: string };
}

export interface OnCallSchedule {
  id: string;
  name: string;
  createdAt: string;
  shifts: OnCallShift[];
}

export interface EscalationTier {
  id: string;
  sortOrder: number;
  escalateAfterMinutes: number;
  user: { id: string; name: string } | null;
  onCallSchedule: { id: string; name: string } | null;
}

export type EscalationRunStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'EXHAUSTED';

export interface EscalationRun {
  id: string;
  currentTierIndex: number;
  status: EscalationRunStatus;
  acknowledgedAt: string | null;
  acknowledgedByUser: { id: string; name: string } | null;
  createdAt: string;
}

export interface SavedViewFilters {
  statusCategory?: TicketStatusCategory;
  assigneeId?: string;
  priority?: TicketPriority;
}

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  sortOrder: number;
  createdAt: string;
}

export type NotificationEventType = 'TICKET_ASSIGNED' | 'NEW_REPLY';

export interface AppNotification {
  id: string;
  eventType: NotificationEventType;
  ticket: { id: string; number: number; subject: string } | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  eventType: NotificationEventType;
  label: string;
  inApp: boolean;
  email: boolean;
}

export interface AiUsageLog {
  id: string;
  action: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // A Decimal column serializes as a numeric string over JSON, or null for
  // an unrecognized model -- see packages/ai-adapters/src/pricing.ts.
  estimatedCostUsd: string | null;
  createdAt: string;
}

export interface TicketAiUsage {
  logs: AiUsageLog[];
  totalCalls: number;
  totalCostUsd: number;
}

export type PublicServiceStatusLevel = 'operational' | 'degraded' | 'outage';

export interface PublicServiceStatus {
  id: string;
  name: string;
  status: PublicServiceStatusLevel;
  openIncidents: number;
}

export interface PublicStatusPage {
  overall: PublicServiceStatusLevel;
  services: PublicServiceStatus[];
}

export interface AiUsageSummary {
  totalCalls: number;
  totalCostUsd: number;
  byAction: { action: string; calls: number; costUsd: number }[];
  recent: (AiUsageLog & { ticket: { id: string; number: number; subject: string } | null })[];
}

export interface AiToolDefinitionSummary {
  name: string;
  description: string;
  mutating: boolean;
}

export interface AutonomyPolicy {
  autoExecuteTools: string[];
  maxActionsPerDay: number;
}

export type AiAgentRunStatus = 'PENDING_APPROVAL' | 'EXECUTED' | 'REJECTED' | 'FAILED';

export interface AutonomousLoopResult {
  summary: string;
  steps: { iteration: number; toolCalls: { name: string; input: unknown; result: unknown }[] }[];
  stoppedReason: 'completed' | 'max_iterations';
}

export interface AiAgentRun {
  id: string;
  toolName: string;
  args: unknown;
  result: unknown;
  status: AiAgentRunStatus;
  source: string;
  errorMessage: string | null;
  ticket: { id: string; number: number; subject: string } | null;
  reviewedByUser: { id: string; name: string } | null;
  reviewedAt: string | null;
  createdAt: string;
}
