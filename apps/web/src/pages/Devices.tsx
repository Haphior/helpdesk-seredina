import { useEffect, useState } from 'react';
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
  caCertSha256: string | null;
}

/**
 * docs/adr/0054-server-address-and-tls.md: the address is whatever the
 * operator configured (API_PUBLIC_URL), editable here for a device that
 * reaches the server some other way (a VPN address, an internal DNS name).
 * With a non-public certificate, the command pins the server's CA by its
 * fingerprint, so the device trusts exactly that CA and nothing else.
 */
function buildEnrollCommand(serverUrl: string, token: string, caCertSha256: string | null): string {
  const url = serverUrl.trim().replace(/\/$/, '');
  return `node src/index.mjs enroll --url ${url} --token ${token}${caCertSha256 ? ` --ca-sha256 ${caCertSha256}` : ''}`;
}

export function Devices() {
  const [devices, setDevices] = useState<DeviceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrollToken, setEnrollToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [agentSetup, setAgentSetup] = useState<AgentSetup | null>(null);
  const [serverUrl, setServerUrl] = useState(API_URL);

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
    enrollToken && serverUrlValid ? buildEnrollCommand(serverUrl, enrollToken, agentSetup?.caCertSha256 ?? null) : null;

  function load() {
    apiGet<{ devices: DeviceListItem[] }>('/devices')
      .then((res) => setDevices(res.devices))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load devices'));
  }

  useEffect(load, []);

  async function generateToken() {
    setError(null);
    setGenerating(true);
    try {
      const { token } = await apiPost<{ token: string; expiresAt: string }>('/devices/enrollment-tokens', {});
      setEnrollToken(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate an enrollment token');
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(device: DeviceListItem) {
    if (!confirm(`Revoke "${device.asset.name}"? It will stop checking in until re-enrolled.`)) return;
    try {
      await apiPost(`/devices/${device.id}/revoke`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke device');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Devices</h1>
        <Button onClick={generateToken} isLoading={generating}>
          Generate enrollment command
        </Button>
      </div>
      <p className="mb-5 max-w-2xl text-[13.5px] text-slate-500">
        A lightweight agent reports hardware/software inventory, OS version, disk encryption, and
        antivirus status from a real device — inventory-only in this release, nothing runs remotely.
        Enrolled devices show up here and in{' '}
        <Link to="/assets" className="text-indigo-700 hover:underline">
          Assets
        </Link>
        , tagged "AGENT".
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      <Card className="mb-5 max-w-2xl !p-5">
        <div className="mb-3">
          <Input
            id="agent-server-url"
            label="Server address for agents"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://helpdesk.example.com/api"
            aria-invalid={!serverUrlValid}
          />
          <p className="mt-1.5 text-[12.5px] text-slate-500">
            {serverUrlValid
              ? 'The address devices use to reach this server — change it if they connect another way, e.g. over a VPN.'
              : 'Enter a full address starting with https:// (or http://).'}
          </p>
          {serverUrlValid && serverUrl.trim().startsWith('http://') && (
            <p className="mt-1 text-[12.5px] text-amber-700">
              Without https://, each device's credential and inventory travel unencrypted.
            </p>
          )}
          {agentSetup?.caCertSha256 && (
            <p className="mt-1 text-[12.5px] text-slate-500">
              This server uses its own certificate authority. The command below includes its fingerprint, so the agent
              trusts exactly that CA.
            </p>
          )}
        </div>
        {enrollCommand ? (
          <>
            <h2 className="mb-1 text-[15px] font-bold text-slate-800">Run this on the device</h2>
            <p className="mb-3 text-[12.5px] text-slate-500">
              Valid for 15 minutes, and works once. Requires Node.js on the device; run it from the agent's folder.
            </p>
            <CopyableCodeBlock label="Enrollment command" value={enrollCommand} />
          </>
        ) : (
          <p className="text-[12.5px] text-slate-500">Generate an enrollment command to add a device.</p>
        )}
      </Card>

      {devices === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {devices?.length === 0 && <p className="text-sm text-slate-500">No devices enrolled yet.</p>}

      {devices && devices.length > 0 && (
        <Card className="max-w-4xl overflow-hidden p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">Hostname</th>
                <th className="px-5 py-2.5">Platform</th>
                <th className="px-5 py-2.5">Last check-in</th>
                <th className="px-5 py-2.5">Status</th>
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
                    {d.asset.lastSeenAt ? formatDateTime(d.asset.lastSeenAt) : 'Never'}
                  </td>
                  <td className="px-5 py-3">
                    {d.revokedAt ? (
                      <Badge tone="slate">Revoked</Badge>
                    ) : (
                      <Badge tone="emerald" dot>
                        Active
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-xs">
                    {!d.revokedAt && (
                      <button onClick={() => revoke(d)} className="text-slate-400 hover:text-rose-600">
                        revoke
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
