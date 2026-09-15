const PALETTES = [
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-orange-100', text: 'text-orange-700' },
  { bg: 'bg-slate-200', text: 'text-slate-600' },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function paletteFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  const { bg, text } = paletteFor(name);
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold ${bg} ${text}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initials(name)}
    </span>
  );
}
