import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { EmailChannel } from '../lib/types';
import { Modal } from '../components/Modal';
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
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Email Channels</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New channel
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Tickets are created from mail polled via IMAP; agent replies are sent back via SMTP. See
        docs/adr/0004-email-channel.md.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {channels === null && <p className="text-sm text-slate-500">Loading…</p>}
      {channels?.length === 0 && <p className="text-sm text-slate-500">No email channel configured yet.</p>}

      {channels && channels.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">IMAP</th>
                <th className="px-4 py-2 font-medium">SMTP</th>
                <th className="px-4 py-2 font-medium">Last polled</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {channels.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-2 text-slate-600">{c.fromAddress}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.imapHost}:{c.imapPort}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.smtpHost}:{c.smtpPort}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {c.lastPolledAt ? formatDateTime(c.lastPolledAt) : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    <button onClick={() => remove(c)} className="text-slate-400 hover:text-red-600">
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateChannelModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
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
        <Field label="Name" value={name} onChange={setName} required />
        <Field label="From address" type="email" value={fromAddress} onChange={setFromAddress} required />

        <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
          Inbound (IMAP)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Host" value={imapHost} onChange={setImapHost} required />
          <Field label="Port" value={imapPort} onChange={setImapPort} required />
        </div>
        <Field label="Username" value={imapUsername} onChange={setImapUsername} required />
        <Field label="Password" type="password" value={imapPassword} onChange={setImapPassword} required />
        <Checkbox label="Use TLS" checked={imapSecure} onChange={setImapSecure} />

        <div className="border-t border-slate-200 pt-2 text-xs font-medium uppercase text-slate-400">
          Outbound (SMTP)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Host" value={smtpHost} onChange={setSmtpHost} required />
          <Field label="Port" value={smtpPort} onChange={setSmtpPort} required />
        </div>
        <Field label="Username" value={smtpUsername} onChange={setSmtpUsername} required />
        <Field label="Password" type="password" value={smtpPassword} onChange={setSmtpPassword} required />
        <Checkbox label="Use TLS" checked={smtpSecure} onChange={setSmtpSecure} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
