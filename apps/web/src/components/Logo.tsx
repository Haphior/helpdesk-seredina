// The mark: three unequal arcs curving into one solid center point -- "Seredina"
// (середина) is Slavic for "the middle," and the product's job is literally this:
// email/API/NOC-SOC alerts arrive from different places and converge into one
// ticket. Deliberately asymmetric (three different arc lengths/curvatures, three
// differently-sized source dots) rather than a symmetric spoke-hub, so it reads as
// this one specific idea instead of a generic network/tech glyph. Read by an early
// viewer as "a hand waving hello, reaching out to help" -- a happy accident that
// fits a helpdesk brand and is worth keeping in mind, not designing away.
//
// Stroke width 16 (not the original 9) -- verified against the real render math
// that 9 in this 200-unit viewBox drops below 1px at the 26-30px sizes this
// component is actually used at. 'onLightBg' (default) and 'onDarkBg' are named
// for WHERE the mark sits, not the shade of its own strokes -- the previous
// 'light'/'dark' names described the stroke color instead, which is how a pale,
// low-contrast palette ended up shipped on the white sidebar (see
// docs/adr/0011-sla-engine.md's postscript on this session's other debugging
// detour; this one's just a plain naming bug, not infra). 'mono' is unchanged:
// solid white at varying opacity, for the saturated indigo/violet brand panel
// itself (Login/Register) where the full-color gradient core would blend into a
// same-hue background instead of standing out.
//
// Below ~32px, this component's own geometry stops being the right tool -- see
// public/favicon.svg for the dedicated micro-glyph used at that size instead of a
// shrunk copy of this one.
//
// Re-angled 2026-09-16: the original three endpoints (~235°/12°/70° from
// center) clustered two arms together on one side with the third alone on
// the other -- a pareidolia risk flagged from outside the team (a vertical
// "stem" above a "two-lobed base" reading). Re-angled to 8°/132°/242° so the
// longest arm points essentially sideways rather than any arm sitting near
// vertical, while keeping the exact same curve style, unequal arc lengths,
// and unequal dot sizes -- the asymmetric-channels story is unchanged, only
// the angles are. Verified by rendering every candidate at real size before
// picking this one over three more conservative (pure-rotation) options.
type LogoVariant = 'onLightBg' | 'onDarkBg' | 'mono';

export function Logo({ size = 32, variant = 'onLightBg' }: { size?: number; variant?: LogoVariant }) {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path d="M100 100 C 125.3 116.2, 155.5 125.1, 177.2 110.9" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="16" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 74.6 111.0, 52.1 129.5, 51.8 153.5" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="16" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 98.1 68.5, 87.1 37.2, 61.5 27.6" stroke="#ffffff" strokeOpacity="0.42" strokeWidth="16" strokeLinecap="round" fill="none" />
        <circle cx="177.2" cy="110.9" r="17" fill="#ffffff" fillOpacity="0.6" />
        <circle cx="51.8" cy="153.5" r="13" fill="#ffffff" fillOpacity="0.8" />
        <circle cx="61.5" cy="27.6" r="15" fill="#ffffff" fillOpacity="0.45" />
        <circle cx="100" cy="100" r="32" fill="#ffffff" />
      </svg>
    );
  }

  // onLightBg: dark, saturated ink -- for the white/slate-50 surfaces this is
  // actually used on (nav sidebar). onDarkBg: the pale set, reserved for a dark
  // surface that isn't the saturated mono panel (nothing uses this yet).
  const arcColors = variant === 'onLightBg' ? ['#6366f1', '#818cf8', '#a78bfa'] : ['#a5b4fc', '#c7d2fe', '#ddd6fe'];
  const dotColors = variant === 'onLightBg' ? ['#4f46e5', '#6366f1', '#818cf8'] : ['#818cf8', '#a5b4fc', '#c4b5fd'];

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="seredina-core" x1="70" y1="70" x2="130" y2="130">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M100 100 C 125.3 116.2, 155.5 125.1, 177.2 110.9" stroke={arcColors[0]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 74.6 111.0, 52.1 129.5, 51.8 153.5" stroke={arcColors[1]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 98.1 68.5, 87.1 37.2, 61.5 27.6" stroke={arcColors[2]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <circle cx="177.2" cy="110.9" r="17" fill={dotColors[0]} />
      <circle cx="51.8" cy="153.5" r="13" fill={dotColors[1]} />
      <circle cx="61.5" cy="27.6" r="15" fill={dotColors[2]} />
      <circle cx="100" cy="100" r="32" fill="url(#seredina-core)" />
    </svg>
  );
}
