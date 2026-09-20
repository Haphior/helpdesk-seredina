import { useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../lib/api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser -- the value is still
      // shown and selectable, so this never blocks the actual task.
    }
  }

  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-medium text-slate-700">{label}</span>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 truncate rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-700">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={copy} className="flex-shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function CopyableCodeBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser -- the value is still shown and selectable.
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="block text-[12.5px] font-medium text-slate-700">{label}</span>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md border border-slate-300 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-700">
        <code>{value}</code>
      </pre>
    </div>
  );
}

// Every value read via params.* below comes from this Media Type's own
// webhook parameters (defined in Zabbix's UI, not hardcoded here) -- the
// exact same script text works for every tenant/deployment; only the
// api_url/api_key parameter VALUES differ per tenant. Macro names and the
// HttpRequest/JSON.parse(value) script shape confirmed against Zabbix's own
// webhook documentation and example scripts, not guessed -- see
// docs/adr/0046-zabbix-integration.md.
const ZABBIX_WEBHOOK_SCRIPT = `try {
    var params = JSON.parse(value);

    var SEVERITY_MAP = {
        'Not classified': 'INFO',
        'Information': 'INFO',
        'Warning': 'LOW',
        'Average': 'MEDIUM',
        'High': 'HIGH',
        'Disaster': 'CRITICAL'
    };

    var body = {
        source: 'Zabbix',
        title: params.title,
        description: 'Host: ' + params.host + '\\nSeverity: ' + params.severity + '\\n' + params.date + ' ' + params.time,
        externalId: params.event_id,
        severity: SEVERITY_MAP[params.severity] || 'MEDIUM'
    };

    var req = new HttpRequest();
    req.addHeader('Content-Type: application/json');
    req.addHeader('Authorization: Bearer ' + params.api_key);

    var resp = req.post(params.api_url, JSON.stringify(body));

    if (req.getStatus() < 200 || req.getStatus() >= 300) {
        throw 'Seredina API returned status ' + req.getStatus() + ': ' + resp;
    }

    return JSON.stringify({ result: 'OK' });
}
catch (error) {
    Zabbix.log(3, '[ Seredina ] Error: ' + error);
    throw 'Failed to send alert to Seredina: ' + error;
}`;

export function MonitoringIntegrations() {
  const grafanaUrl = `${API_URL}/v1/alerts/grafana`;
  const genericAlertsUrl = `${API_URL}/v1/alerts`;

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Monitoring Integrations</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        Turn alerts from a monitoring or alerting tool you already run into tickets here. Seredina
        integrates with these tools rather than replacing them — see{' '}
        <Link to="/api-keys" className="text-indigo-700 hover:underline">
          API Keys
        </Link>{' '}
        for the generic API too.
      </p>

      <Card className="max-w-xl !p-5">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">Grafana Alerting</h2>
        <p className="mb-4 text-[12.5px] text-slate-500">
          Works with Grafana's default alert notification payload — no custom notification
          template needed on the Grafana side.
        </p>

        <ol className="mb-4 list-decimal space-y-3 pl-5 text-[13px] text-slate-700">
          <li>
            <Link to="/api-keys" className="text-indigo-700 hover:underline">
              Create an API key
            </Link>{' '}
            for this integration (any name — e.g. "Grafana").
          </li>
          <li>
            In Grafana, go to <strong>Alerting → Contact points → Add contact point</strong>, choose{' '}
            <strong>Webhook</strong> as the integration, and paste in the URL below.
          </li>
          <li>
            Under the webhook's <strong>HTTP settings</strong>, add a custom header named{' '}
            <code className="rounded bg-slate-100 px-1">Authorization</code> with the value{' '}
            <code className="rounded bg-slate-100 px-1">Bearer &lt;your API key&gt;</code>.
          </li>
          <li>Attach this contact point to whichever alert rules/notification policy you want flowing into Seredina.</li>
        </ol>

        <CopyableField label="Webhook URL" value={grafanaUrl} />

        <p className="mt-4 text-[12px] text-slate-400">
          A tenant-defined <code className="rounded bg-slate-100 px-1">severity</code> label on an alert rule
          (e.g. "critical", "warning", "info") maps to Seredina's priority automatically; alerts with no
          severity label default to Normal priority. Re-firing and resolved notifications for the same alert
          group fold into the same ticket while it's still open, instead of creating a new one each time.
        </p>
      </Card>

      <Card className="mt-5 max-w-xl !p-5">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">Zabbix</h2>
        <p className="mb-4 text-[12.5px] text-slate-500">
          Unlike Grafana, Zabbix's webhook has no default payload shape of its own — it always runs a
          script you provide. Paste the one below into a new Webhook media type; it already speaks
          Seredina's generic alerts API, no changes needed.
        </p>

        <ol className="mb-4 list-decimal space-y-3 pl-5 text-[13px] text-slate-700">
          <li>
            <Link to="/api-keys" className="text-indigo-700 hover:underline">
              Create an API key
            </Link>{' '}
            for this integration (any name — e.g. "Zabbix").
          </li>
          <li>
            In Zabbix, go to <strong>Alerts → Media types → Create media type</strong>, set the type to{' '}
            <strong>Webhook</strong>, and paste the script below into its <strong>Script</strong> field.
          </li>
          <li>
            Add these <strong>Parameters</strong> (name → value) to the media type — the script reads
            them, so the names must match exactly:
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] text-slate-600">
              <li>
                <code className="rounded bg-slate-100 px-1">api_url</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{genericAlertsUrl}</code>
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">api_key</code> → your API key from step 1
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">event_id</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{EVENT.ID}'}</code>
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">severity</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{EVENT.SEVERITY}'}</code>
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">title</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{TRIGGER.NAME}'}</code>
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">host</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{HOST.NAME}'}</code>
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1">date</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{EVENT.DATE}'}</code>, and{' '}
                <code className="rounded bg-slate-100 px-1">time</code> →{' '}
                <code className="rounded bg-slate-100 px-1">{'{EVENT.TIME}'}</code>
              </li>
            </ul>
          </li>
          <li>
            Create a Zabbix user with this media type attached, then an <strong>Action</strong> (under{' '}
            <strong>Alerts → Actions → Trigger actions</strong>) with condition{' '}
            <strong>Event type = Problem</strong> that notifies it. Restricting to Problem events here —
            not in the script — is deliberate: Zabbix's own Action conditions are the documented way to
            do this, so resolved/OK notifications simply never reach the script at all.
          </li>
        </ol>

        <div className="flex flex-col gap-4">
          <CopyableField label="Seredina alerts API URL" value={genericAlertsUrl} />
          <CopyableCodeBlock label="Webhook script" value={ZABBIX_WEBHOOK_SCRIPT} />
        </div>

        <p className="mt-4 text-[12px] text-slate-400">
          Zabbix's own severity scale (Not classified/Information/Warning/Average/High/Disaster) maps to
          Seredina's priority automatically. A re-fired problem for the same event id folds into the same
          open ticket instead of creating a new one each time.
        </p>
      </Card>
    </div>
  );
}
