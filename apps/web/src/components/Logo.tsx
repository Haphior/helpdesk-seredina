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
type LogoVariant = 'onLightBg' | 'onDarkBg' | 'mono';

export function Logo({ size = 32, variant = 'onLightBg' }: { size?: number; variant?: LogoVariant }) {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path d="M100 100 C 60 88, 34 50, 40 14" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="16" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 130 80, 168 84, 182 118" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="16" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 84 138, 96 172, 132 186" stroke="#ffffff" strokeOpacity="0.42" strokeWidth="16" strokeLinecap="round" fill="none" />
        <circle cx="40" cy="14" r="15" fill="#ffffff" fillOpacity="0.6" />
        <circle cx="182" cy="118" r="17" fill="#ffffff" fillOpacity="0.8" />
        <circle cx="132" cy="186" r="14" fill="#ffffff" fillOpacity="0.45" />
        <circle cx="100" cy="100" r="32" fill="#ffffff" />
      </svg>
    );
  }

  // onLightBg: dark, saturated ink -- for the white/slate-50 surfaces this is
  // actually used on (nav sidebar). onDarkBg: the pale set, reserved for a dark
  // surface that isn't the saturated mono panel (nothing uses this yet).
  const arcColors = variant === 'onLightBg' ? ['#818cf8', '#6366f1', '#a78bfa'] : ['#c7d2fe', '#a5b4fc', '#ddd6fe'];
  const dotColors = variant === 'onLightBg' ? ['#6366f1', '#4f46e5', '#818cf8'] : ['#a5b4fc', '#c4b5fd', '#ddd6fe'];

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="seredina-core" x1="70" y1="70" x2="130" y2="130">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M100 100 C 60 88, 34 50, 40 14" stroke={arcColors[0]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 130 80, 168 84, 182 118" stroke={arcColors[1]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 84 138, 96 172, 132 186" stroke={arcColors[2]} strokeWidth="16" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="14" r="15" fill={dotColors[0]} />
      <circle cx="182" cy="118" r="17" fill={dotColors[1]} />
      <circle cx="132" cy="186" r="14" fill={dotColors[2]} />
      <circle cx="100" cy="100" r="32" fill="url(#seredina-core)" />
    </svg>
  );
}
