import type { ReactNode } from 'react';
import { CheckIcon } from './icons';

export function AuthLayout({
  tagline,
  bullets,
  children,
}: {
  tagline: string;
  bullets: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-white font-sans">
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-500 to-violet-500 p-11 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1.4px, transparent 1.4px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex items-center gap-2.5">
          <div className="h-[30px] w-[30px] rounded-lg border border-white/30 bg-white/15" />
          <span className="text-[17px] font-extrabold tracking-tight text-white">Seredina</span>
        </div>

        <div className="relative">
          <p className="mb-[18px] text-[26px] font-bold leading-snug tracking-tight text-white">{tagline}</p>
          <div className="flex flex-col gap-2.5">
            {bullets.map((b) => (
              <div key={b} className="flex items-center gap-2.5">
                <CheckIcon width={15} height={15} className="flex-shrink-0 text-white" />
                <span className="text-[13.5px] text-white/90">{b}</span>
              </div>
            ))}
          </div>
        </div>

        <span className="relative text-xs text-white/55">© Seredina — AGPL-3.0</span>
      </div>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-[360px]">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        required
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[9px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  );
}
