import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { EmailChannel } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { formatDateTime } from '../lib/format';

export function EmailChannels() {
  const [channels, setChannels] = useState<EmailChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiGet<{ emailChannels: EmailChannel[] }>('/email-channels')
      .then((res) => setChannels(res.emailChannels))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load email channels'));
  }

  useEffect(load, []);

  async function remove(channel: EmailChannel) {
    if (!confirm(`Delete email channel "${channel.name}"?`)) return;
    try {
      await apiDelete(`/email-channels/${channel.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete channel');
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Email Channels</h1>
        <Button onClick={() => setShowCreate(true)}>New channel</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">
        Tickets are created from mail polled via IMAP; agent replies are sent back via SMTP. See
        docs/adr/0004-email-channel.md.
      </p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {channels === null && <p className="text-sm text-slate-500">Loading…</p>}
      {channels?.length === 0 && <p className="text-sm text-slate-500">No email channel configured yet.</p>}

      {channels && channels.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">Name</th>
                <th className="px-5 py-2.5">From</th>
                <th className="px-5 py-2.5">IMAP</th>
                <th className="px-5 py-2.5">SMTP</th>
                <th className="px-5 py-2.5">Last polled</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {channels.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{c.name}</td>
                  <td className="px-5 py-3 text-slate-600">{c.fromAddress}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.imapHost}:{c.imapPort}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {c.smtpHost}:{c.smtpPort}
                  </td>
                  <td className="px-5 py-3 text-slate-400">{c.lastPolledAt ? formatDateTime(c.lastPolledAt) : 'Never'}</td>
                  <td className="px-5 py-3 text-right text-xs">
                    <button onClick={() => remove(c)} className="text-slate-400 hover:text-rose-600">
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && <CreateChannelModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

function CreateChannelModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/email-channels', {
        name,
        fromAddress,
        imapHost,
        imapPort: Number(imapPort),
        imapSecure,
        imapUsername,
        imapPassword,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure,
        smtpUsername,
        smtpPassword,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create channel');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New email channel" onClose={onClose}>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="From address" type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} required />

        <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
          Inbound (IMAP)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} required />
          <Input label="Port" value={imapPort} onChange={(e) => setImapPort(e.target.value)} required />
        </div>
        <Input label="Username" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
        <Input label="Password" type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} required />
        <Checkbox label="Use TLS" checked={imapSecure} onChange={setImapSecure} />

        <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
          Outbound (SMTP)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required />
          <Input label="Port" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} required />
        </div>
        <Input label="Username" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required />
        <Input label="Password" type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} required />
        <Checkbox label="Use TLS" checked={smtpSecure} onChange={setSmtpSecure} />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
      {label}
    </label>
  );
}
