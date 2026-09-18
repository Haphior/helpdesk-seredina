import type { SelectHTMLAttributes } from 'react';
import { ChevronDownIcon } from './icons';

type LabeledProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: false };

type HiddenLabelProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'aria-label'> & {
  label?: undefined;
  hideLabel: true;
  'aria-label': string;
};

export type SelectProps = LabeledProps | HiddenLabelProps;

// Native <select> is kept deliberately -- it already gives correct keyboard
// nav, screen-reader announcement, and OS-native option list for free; a
// custom-styled dropdown would have to rebuild all of that. This is only the
// shared visual shell TicketsQueue.tsx's two competing select stylings
// should have been.
const selectClass =
  'w-full appearance-none rounded-[7px] border border-slate-200 bg-white px-3 py-2 pr-8 text-[13px] text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400';

function SelectField({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`${selectClass} ${className}`} {...rest}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" width={14} height={14} />
    </div>
  );
}

export function Select({ label, hideLabel, children, ...rest }: SelectProps) {
  const select = <SelectField {...rest}>{children}</SelectField>;

  if (hideLabel) return select;

  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{label}</span>
      {select}
    </label>
  );
}
