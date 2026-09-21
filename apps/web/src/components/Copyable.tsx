import { useState } from 'react';
import { Button } from './Button';

export function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser -- the value is still
      // shown and selectable, so this never blocks the actual task.
    }
  }

  return (
    <div>
      <span className="mb-1 block text-[12.5px] font-medium text-slate-700">{label}</span>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 truncate rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[12.5px] text-slate-700">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={copy} className="flex-shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function CopyableCodeBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser -- the value is still shown and selectable.
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="block text-[12.5px] font-medium text-slate-700">{label}</span>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md border border-slate-300 bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-slate-700">
        <code>{value}</code>
      </pre>
    </div>
  );
}
