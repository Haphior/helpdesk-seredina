import { useState } from 'react';
import { downloadFile, ApiError } from '../lib/api';
import { Button } from '../components/Button';

export function DataExport() {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setStatus('downloading');
    setError(null);
    try {
      await downloadFile('/export');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Failed to download export');
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">Data Export</h1>
      <p className="mb-6 max-w-xl text-[13.5px] text-slate-500">
        Download every tenant table — tickets, messages, assets, macros, SLA policies, and the rest — as a single
        open JSON file. No lock-in: this is the same file you'd hand to any other system, or use to self-host a
        backup. Secrets (passwords, API key hashes, webhook signing secrets) are never included.
      </p>

      <Button type="button" onClick={handleDownload} isLoading={status === 'downloading'}>
        {status === 'downloading' ? 'Preparing download…' : 'Download export (JSON)'}
      </Button>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
