import type { InputHTMLAttributes, ReactNode } from 'react';

type SharedProps = { icon?: ReactNode };

type LabeledProps = InputHTMLAttributes<HTMLInputElement> & SharedProps & { label: string; hideLabel?: false };

// A visible label is the common case; a search box or inline table filter
// sometimes has no room for one, but every such usage must still name
// itself for assistive tech -- same discriminated-union guardrail as
// Button's iconOnly, so an unlabeled input fails to compile, not just to
// fail a later audit.
type HiddenLabelProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-label'> &
  SharedProps & {
    label?: undefined;
    hideLabel: true;
    'aria-label': string;
  };

export type InputProps = LabeledProps | HiddenLabelProps;

// text-[16px] on the input itself, shrinking back to the app's usual 13.5px
// at the sm breakpoint -- an input below 16px makes iOS Safari zoom the page
// on focus, and this is the one property (font-size at focus time) that
// zoom actually keys off, so it can't be fixed by CSS zoom/viewport tricks
// after the fact.
const inputClass =
  'w-full rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400 sm:text-[13.5px]';

export function Input({ label, hideLabel, icon, className = '', spellCheck = false, autoComplete = 'off', ...rest }: InputProps) {
  const field = icon ? (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
      <input spellCheck={spellCheck} autoComplete={autoComplete} className={`${inputClass} pl-9 ${className}`} {...rest} />
    </div>
  ) : (
    <input spellCheck={spellCheck} autoComplete={autoComplete} className={`${inputClass} ${className}`} {...rest} />
  );

  if (hideLabel) return field;

  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{label}</span>
      {field}
    </label>
  );
}
