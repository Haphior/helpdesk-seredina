import { ingestAlert, type AlertSeverity } from '../tickets/service';

/**
 * A named, real Grafana Alerting integration (Phase 4, see
 * docs/adr/0039-monitoring-integrations.md) -- the concrete first step
 * behind "one or two of the monitoring tools already implicitly supported
 * through POST /v1/alerts" (docs/ROADMAP.md's Phase 4). ADR 0003 kept
 * severity-mapping "the integrator's job" to stay tool-agnostic at the
 * generic /v1/alerts endpoint; this doesn't reverse that decision, it adds
 * a second, named endpoint on top of it specifically so Grafana's own
 * default webhook payload -- unmodified, no custom notification template
 * required in Grafana itself -- maps automatically. The generic endpoint
 * keeps working exactly as before for every other tool.
 *
 * Payload shape confirmed against Grafana's own webhook notifier docs, not
 * guessed -- every field read here is real and documented, not invented.
 */
export interface GrafanaWebhookPayload {
  status: 'firing' | 'resolved';
  title?: string;
  message?: string;
  groupKey?: string;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  alerts?: Array<{ status?: string; labels?: Record<string, string>; annotations?: Record<string, string> }>;
}

// Grafana has no fixed severity scale of its own -- `severity` is a common,
// but not enforced, label convention teams attach to alert rules. Anything
// unrecognized (including no label at all) deliberately falls through to
// undefined -- ingestAlert() already has its own sensible default for that
// case, rather than this adapter guessing at a severity it was never told.
const SEVERITY_LABEL_MAP: Record<string, AlertSeverity> = {
  critical: 'CRITICAL',
  disaster: 'CRITICAL',
  high: 'HIGH',
  page: 'HIGH',
  warning: 'MEDIUM',
  medium: 'MEDIUM',
  average: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
  information: 'INFO',
  none: 'INFO',
};

function mapSeverity(payload: GrafanaWebhookPayload): AlertSeverity | undefined {
  const label = payload.commonLabels?.severity?.toLowerCase();
  return label ? SEVERITY_LABEL_MAP[label] : undefined;
}

function buildFallbackDescription(payload: GrafanaWebhookPayload): string {
  const lines: string[] = [`Status: ${payload.status}`];
  for (const [key, value] of Object.entries(payload.commonAnnotations ?? {})) {
    lines.push(`${key}: ${value}`);
  }
  if (payload.alerts && payload.alerts.length > 0) {
    lines.push(`${payload.alerts.length} alert(s) in this group.`);
  }
  return lines.join('\n');
}

/**
 * One ticket (or one message on an existing open ticket, via ingestAlert's
 * own dedup -- see ADR 0003) per Grafana webhook CALL, not per individual
 * alert inside it -- Grafana already groups related alerts by groupLabels
 * before calling the webhook, so treating each call as one incident matches
 * Grafana's own grouping intent rather than fragmenting it back apart.
 * `groupKey` is stable across the same group's later firing/resolved calls,
 * which is exactly what ingestAlert's externalId-based dedup needs.
 */
export async function ingestGrafanaAlert(tenantId: string, payload: GrafanaWebhookPayload) {
  const alertName = payload.commonLabels?.alertname ?? 'Grafana alert';
  const title = payload.title?.trim() || `[${payload.status.toUpperCase()}] ${alertName}`;
  const description = payload.message?.trim() || buildFallbackDescription(payload);

  return ingestAlert(tenantId, {
    source: 'Grafana',
    severity: mapSeverity(payload),
    title,
    description,
    externalId: payload.groupKey ?? alertName,
  });
}
