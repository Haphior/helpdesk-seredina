import type { HTMLAttributes } from 'react';

// The one shared shell for a pattern that was already duplicated verbatim in
// Dashboard.tsx and TicketsQueue.tsx (rounded-xl border border-slate-200
// bg-white p-4 shadow-sm) -- docs/DESIGN_SYSTEM.md's own elevation rule:
// a single shadow-sm, never stacked.
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`} {...rest} />;
}
