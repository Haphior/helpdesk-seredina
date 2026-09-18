import type { TextareaHTMLAttributes } from 'react';

type LabeledProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hideLabel?: false };

type HiddenLabelProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'aria-label'> & {
  label?: undefined;
  hideLabel: true;
  'aria-label': string;
};

export type TextareaProps = LabeledProps | HiddenLabelProps;

const textareaClass =
  'w-full rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400';

export function Textarea({ label, hideLabel, className = '', ...rest }: TextareaProps) {
  const field = <textarea className={`${textareaClass} ${className}`} {...rest} />;

  if (hideLabel) return field;

  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{label}</span>
      {field}
    </label>
  );
}
