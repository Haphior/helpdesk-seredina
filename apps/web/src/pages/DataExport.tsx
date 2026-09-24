import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile, ApiError } from '../lib/api';
import { Button } from '../components/Button';

export function DataExport() {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('dataExport.failed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('dataExport.title')}</h1>
      <p className="mb-6 max-w-xl text-[13.5px] text-slate-500">
        {t('dataExport.intro')}
      </p>

      <Button type="button" onClick={handleDownload} isLoading={status === 'downloading'}>
        {status === 'downloading' ? t('dataExport.preparing') : t('dataExport.download')}
      </Button>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
