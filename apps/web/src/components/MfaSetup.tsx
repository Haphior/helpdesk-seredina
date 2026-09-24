import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface MfaSetupData {
  secret: string;
  otpauthUri: string;
  qrSvg: string;
}

/**
 * Scan-the-QR-code-then-type-a-code step, shared by sign-in enrollment and
 * the account security page. The QR SVG comes from our own API; it's shown
 * through an <img> data URL so nothing in it can ever run as markup.
 */
export function MfaEnroll({
  setup,
  onConfirm,
  submitting,
  error,
}: {
  setup: MfaSetupData;
  onConfirm: (code: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onConfirm(code);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-slate-600">
        <li>{t('mfa.enroll.step1')}</li>
        <li>{t('mfa.enroll.step2')}</li>
        <li>{t('mfa.enroll.step3')}</li>
      </ol>
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
        alt={t('mfa.enroll.qrAlt')}
        width={184}
        height={184}
        className="mx-auto rounded-lg border border-slate-200 bg-white p-2"
      />
      <details className="text-[12.5px] text-slate-500">
        <summary className="cursor-pointer">{t('mfa.enroll.cantScan')}</summary>
        <code className="mt-1 block break-all rounded bg-slate-50 px-2 py-1 font-mono text-[12.5px] text-slate-800">{setup.secret}</code>
      </details>
      <CodeInput value={code} onChange={setCode} label={t('mfa.codeLabel')} />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting || code.replace(/\s/g, '').length < 6}
        className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? t('mfa.verifying') : t('mfa.enroll.confirm')}
      </button>
    </form>
  );
}

export function CodeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="text"
        autoComplete="one-time-code"
        autoFocus
        placeholder="123456"
        className="rounded-[9px] border border-slate-200 px-3 py-2.5 text-center font-mono text-[18px] tracking-[0.3em] text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}

/** Shown exactly once after enabling MFA or regenerating codes. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-slate-600">{t('mfa.recovery.explain')}</p>
      <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50 p-3 font-mono text-[13.5px] text-slate-800">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
          }}
          className="flex-1 rounded-[9px] border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          {copied ? t('mfa.recovery.copied') : t('mfa.recovery.copy')}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="seredina-recovery-codes.txt"
          className="flex-1 rounded-[9px] border border-slate-200 px-4 py-2 text-center text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('mfa.recovery.download')}
        </a>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="w-full rounded-[9px] bg-indigo-600 px-4 py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-indigo-700"
      >
        {t('mfa.recovery.saved')}
      </button>
    </div>
  );
}
