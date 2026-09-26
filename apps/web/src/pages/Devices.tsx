import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiGet, apiPost, API_URL, ApiError } from '../lib/api';
import type { DeviceListItem } from '../lib/types';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CopyableCodeBlock } from '../components/Copyable';
import { Input } from '../components/Input';
import { formatDateTime } from '../lib/format';

interface AgentSetup {
  serverUrl: string | null;
  caCertPem: string | null;
  caCertSha256: string | null;
  agentDownloadUrl: string | null;
}

/** The agent lives in its own repository; its releases carry the install scripts. */
const AGENT_RELEASES = 'https://github.com/Haphior/seredina-agent/releases/latest/download';

type AgentPlatform = 'windows' | 'unix' | 'manual';
const AGENT_PLATFORMS: AgentPlatform[] = ['windows', 'unix', 'manual'];

/**
 * docs/adr/0054-server-address-and-tls.md: the address is whatever the
 * operator configured (API_PUBLIC_URL), editable here for a device that
 * reaches the server some other way (a VPN address, an internal DNS name).
 * With a non-public certificate, the command carries the server's CA itself
 * (base64, so it survives any shell), so the device trusts exactly that CA
 * and never has to fetch it from a server it can't verify yet. The install
 * scripts download the agent (from GitHub, or AGENT_DOWNLOAD_URL's mirror),
 * check its SHA-256, enroll, and start the service.
 */
function buildEnrollCommand(
  platform: AgentPlatform,
  serverUrl: string,
  token: string,
  caCertPem: string | null,
  mirror: string | null,
): string {
  const url = serverUrl.trim().replace(/\/$/, '');
  const ca = caCertPem ? btoa(caCertPem) : null;
  const base = mirror ?? AGENT_RELEASES;
  switch (platform) {
    case 'windows':
      return (
        `& ([scriptblock]::Create((irm ${base}/install.ps1))) -Url ${url} -Token ${token}` +
        (ca ? ` -CaPem ${ca}` : '') +
        (mirror ? ` -DownloadBase ${mirror}` : '')
      );
    case 'unix':
      return (
        `curl -fsSL ${base}/install.sh | sudo sh -s -- --url ${url} --token ${token}` +
        (ca ? ` --ca-pem ${ca}` : '') +
        (mirror ? ` --download-base ${mirror}` : '')
      );
    case 'manual':
      return `seredina-agent enroll --url ${url} --token ${token}${ca ? ` --ca-pem ${ca}` : ''} --install`;
  }
}

export function Devices() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrollToken, setEnrollToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [agentSetup, setAgentSetup] = useState<AgentSetup | null>(null);
  const [serverUrl, setServerUrl] = useState(API_URL);
  const [platform, setPlatform] = useState<AgentPlatform>(() =>
    /Windows/i.test(navigator.userAgent) ? 'windows' : 'unix',
  );

  useEffect(() => {
    apiGet<AgentSetup>('/devices/agent-setup')
      .then((setup) => {
        setAgentSetup(setup);
        if (setup.serverUrl) setServerUrl(setup.serverUrl);
      })
      .catch(() => {}); // without it, the console's own API address is a sane default
  }, []);

  const serverUrlValid = /^https?:\/\/[^\s/]+/i.test(serverUrl.trim());
  const enrollCommand =
    enrollToken && serverUrlValid
      ? buildEnrollCommand(
          platform,
          serverUrl,
          enrollToken,
          agentSetup?.caCertPem ?? null,
          agentSetup?.agentDownloadUrl ?? null,
        )
      : null;

  function load() {
    apiGet<{ devices: DeviceListItem[] }>('/devices')
      .then((res) => setDevices(res.devices))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('devices.loadFailed')));
  }

  useEffect(load, []);

  async function generateToken() {
    setError(null);
    setGenerating(true);
    try {
      const { token } = await apiPost<{ token: string; expiresAt: string }>('/devices/enrollment-tokens', {});
      setEnrollToken(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('devices.tokenFailed'));
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(device: DeviceListItem) {
    if (!confirm(t('devices.confirmRevoke', { name: device.asset.name }))) return;
    try {
      await apiPost(`/devices/${device.id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('devices.revokeFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('devices.title')}</h1>
        <Button onClick={generateToken} isLoading={generating}>
          {t('devices.generate')}
        </Button>
      </div>
      <p className="mb-5 max-w-2xl text-[13.5px] text-slate-500">
        <Trans i18nKey="devices.intro" components={{ assets: <Link to="/assets" className="text-indigo-700 hover:underline" /> }} />
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <Card className="mb-5 max-w-2xl !p-5">
        <div className="mb-3">
          <Input
            id="agent-server-url"
            label={t('devices.serverAddress')}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://helpdesk.example.com/api"
            aria-invalid={!serverUrlValid}
          />
          <p className="mt-1.5 text-[12.5px] text-slate-500">
            {serverUrlValid
              ? t('devices.serverHint')
              : t('devices.serverInvalid')}
          </p>
          {serverUrlValid && serverUrl.trim().startsWith('http://') && (
            <p className="mt-1 text-[12.5px] text-amber-700">
              {t('devices.httpWarning')}
            </p>
          )}
          {agentSetup?.caCertSha256 && (
            <p className="mt-1 text-[12.5px] text-slate-500">
              {t('devices.ownCa')} <code className="text-[11.5px]">{agentSetup.caCertSha256?.slice(0, 16)}…</code>
            </p>
          )}
        </div>
        {enrollCommand ? (
          <>
            <h2 className="mb-1 text-[15px] font-bold text-slate-800">{t('devices.runThis')}</h2>
            <p className="mb-3 text-[12.5px] text-slate-500">{t('devices.validity')}</p>
            <div role="radiogroup" aria-label={t('devices.platformChoice')} className="mb-3 flex flex-wrap gap-1.5">
              {AGENT_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  onClick={() => setPlatform(p)}
                  className={`rounded-md border px-2.5 py-1 text-[12.5px] font-semibold ${
                    platform === p
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t(`devices.platforms.${p}`)}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[12.5px] text-slate-500">
              <Trans
                i18nKey={`devices.platformHints.${platform}`}
                components={{
                  releases: (
                    <a
                      href="https://github.com/Haphior/seredina-agent/releases/latest"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-700 hover:underline"
                    />
                  ),
                }}
              />
            </p>
            <CopyableCodeBlock label={t('devices.command')} value={enrollCommand} />
          </>
        ) : (
          <p className="text-[12.5px] text-slate-500">{t('devices.generateHint')}</p>
        )}
      </Card>

      {devices === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {devices?.length === 0 && <p className="text-sm text-slate-500">{t('devices.empty')}</p>}

      {devices && devices.length > 0 && (
        <Card className="max-w-4xl overflow-hidden p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('devices.hostname')}</th>
                <th className="px-5 py-2.5">{t('devices.platform')}</th>
                <th className="px-5 py-2.5">{t('devices.lastCheckIn')}</th>
                <th className="px-5 py-2.5">{t('devices.status')}</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">
                    <Link to={`/assets/${d.asset.id}`} className="hover:underline">
                      {d.asset.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{d.platform}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {d.asset.lastSeenAt ? formatDateTime(d.asset.lastSeenAt) : t('devices.never')}
                  </td>
                  <td className="px-5 py-3">
                    {d.revokedAt ? (
                      <Badge tone="slate">{t('devices.revoked')}</Badge>
                    ) : (
                      <Badge tone="emerald" dot>
                        {t('devices.active')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-xs">
                    {!d.revokedAt && (
                      <button onClick={() => revoke(d)} className="text-slate-400 hover:text-rose-600">
                        {t('devices.revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
