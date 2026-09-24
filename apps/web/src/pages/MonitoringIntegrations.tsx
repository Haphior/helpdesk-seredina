import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { API_URL } from '../lib/api';
import { Card } from '../components/Card';
import { CopyableCodeBlock, CopyableField } from '../components/Copyable';

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
  const { t } = useTranslation();
  const grafanaUrl = `${API_URL}/v1/alerts/grafana`;
  const genericAlertsUrl = `${API_URL}/v1/alerts`;
  const code = <code className="rounded bg-slate-100 px-1" />;
  const apiKeysLink = <Link to="/api-keys" className="text-indigo-700 hover:underline" />;
  const rich = { strong: <strong />, code, apiKeys: apiKeysLink };
  const param = (name: string, value: string) => (
    <li>
      <code className="rounded bg-slate-100 px-1">{name}</code> → <code className="rounded bg-slate-100 px-1">{value}</code>
    </li>
  );

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('monitoring.title')}</h1>
      <p className="mb-6 max-w-2xl text-[13.5px] text-slate-500">
        <Trans i18nKey="monitoring.intro" components={rich} />
      </p>

      <Card className="max-w-xl !p-5">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">Grafana Alerting</h2>
        <p className="mb-4 text-[12.5px] text-slate-500">{t('monitoring.grafana.summary')}</p>

        <ol className="mb-4 list-decimal space-y-3 pl-5 text-[13px] text-slate-700">
          <li>
            <Trans i18nKey="monitoring.createKey" values={{ name: 'Grafana' }} components={rich} />
          </li>
          <li>
            <Trans i18nKey="monitoring.grafana.step2" components={rich} />
          </li>
          <li>
            <Trans i18nKey="monitoring.grafana.step3" components={rich} />
          </li>
          <li>{t('monitoring.grafana.step4')}</li>
        </ol>

        <CopyableField label={t('monitoring.webhookUrl')} value={grafanaUrl} />

        <p className="mt-4 text-[12px] text-slate-400">
          <Trans i18nKey="monitoring.grafana.footer" components={rich} />
        </p>
      </Card>

      <Card className="mt-5 max-w-xl !p-5">
        <h2 className="mb-1 text-[15px] font-bold text-slate-800">Zabbix</h2>
        <p className="mb-4 text-[12.5px] text-slate-500">{t('monitoring.zabbix.summary')}</p>

        <ol className="mb-4 list-decimal space-y-3 pl-5 text-[13px] text-slate-700">
          <li>
            <Trans i18nKey="monitoring.createKey" values={{ name: 'Zabbix' }} components={rich} />
          </li>
          <li>
            <Trans i18nKey="monitoring.zabbix.step2" components={rich} />
          </li>
          <li>
            <Trans i18nKey="monitoring.zabbix.step3" components={rich} />
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] text-slate-600">
              {param('api_url', genericAlertsUrl)}
              <li>
                <code className="rounded bg-slate-100 px-1">api_key</code> → {t('monitoring.zabbix.apiKeyValue')}
              </li>
              {param('event_id', '{EVENT.ID}')}
              {param('severity', '{EVENT.SEVERITY}')}
              {param('title', '{TRIGGER.NAME}')}
              {param('host', '{HOST.NAME}')}
              {param('date', '{EVENT.DATE}')}
              {param('time', '{EVENT.TIME}')}
            </ul>
          </li>
          <li>
            <Trans i18nKey="monitoring.zabbix.step4" components={rich} />
          </li>
        </ol>

        <div className="flex flex-col gap-4">
          <CopyableField label={t('monitoring.zabbix.apiUrl')} value={genericAlertsUrl} />
          <CopyableCodeBlock label={t('monitoring.zabbix.script')} value={ZABBIX_WEBHOOK_SCRIPT} />
        </div>

        <p className="mt-4 text-[12px] text-slate-400">{t('monitoring.zabbix.footer')}</p>
      </Card>
    </div>
  );
}
