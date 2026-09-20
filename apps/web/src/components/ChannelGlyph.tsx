// The "Meet in the Middle" theme's signature detail (docs/adr/0042-tenant-
// theme-system.md): the logo's own 3-circle convergence, made functional --
// highlights which of the 3 channel-groups a ticket actually arrived
// through. Reuses Logo.tsx's exact geometry and colors, just scaled down, so
// this reads as literally the same mark, not a lookalike.
//
// Ticket.channel has 6 real values now (email/api/alert/widget/catalog/
// agent) -- more than existed when the logo's 3-circle meaning was fixed in
// docs/BRAND.md. Mapped down to the original 3: email keeps its own circle;
// api/catalog/widget all go through the same API-shaped mechanism
// (createTicketFromApi) and share the second circle; alert keeps the third;
// agent (a human typed it in by hand) has nothing external converging, so
// all three stay dim.
const CIRCLES = [
  { cx: 78, cy: 88, r: 52, color: '#818cf8' },
  { cx: 128, cy: 72, r: 42, color: '#6366f1' },
  { cx: 112, cy: 132, r: 46, color: '#8b5cf6' },
] as const;

function activeIndex(channel: string): number | null {
  if (channel === 'email') return 0;
  if (channel === 'api' || channel === 'catalog' || channel === 'widget') return 1;
  if (channel === 'alert') return 2;
  return null; // 'agent' and anything unrecognized: no channel converged
}

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Via email',
  api: 'Via API',
  catalog: 'Via service catalog',
  widget: 'Via chat widget',
  alert: 'Via monitoring alert',
  agent: 'Logged by an agent',
};

export function ChannelGlyph({ channel }: { channel: string }) {
  const active = activeIndex(channel);
  const label = CHANNEL_LABEL[channel] ?? `Via ${channel}`;

  return (
    <svg width="20" height="14" viewBox="0 0 200 160" role="img" aria-label={label}>
      <title>{label}</title>
      {CIRCLES.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={c.color} fillOpacity={active === null ? 0.25 : active === i ? 0.9 : 0.16} />
      ))}
    </svg>
  );
}
