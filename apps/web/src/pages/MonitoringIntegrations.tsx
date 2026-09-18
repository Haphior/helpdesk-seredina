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

export function MonitoringIntegrations() {
  const grafanaUrl = `${API_URL}/v1/alerts/grafana`;

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
    </div>
  );
}
