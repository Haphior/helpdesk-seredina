// The mark: three unequal arcs curving into one solid center point -- "Seredina"
// (середина) is Slavic for "the middle," and the product's job is literally this:
// email/API/NOC-SOC alerts arrive from different places and converge into one
// ticket. Deliberately asymmetric (three different arc lengths/curvatures, three
// differently-sized source dots) rather than a symmetric spoke-hub, so it reads as
// this one specific idea instead of a generic network/tech glyph. Read by an early
// viewer as "a hand waving hello, reaching out to help" -- a happy accident that
// fits a helpdesk brand and is worth keeping in mind, not designing away.
// 'light'/'dark' = full color, for a white or slate/navy background (nav, cards).
// 'mono' = solid white at varying opacity, for placement on the saturated
// indigo/violet brand panel itself (Login/Register) where the full-color gradient
// core would blend into a same-hue background instead of standing out.
type LogoVariant = 'light' | 'dark' | 'mono';

export function Logo({ size = 32, variant = 'light' }: { size?: number; variant?: LogoVariant }) {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path d="M100 100 C 60 88, 34 50, 40 14" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 130 80, 168 84, 182 118" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M100 100 C 84 138, 96 172, 132 186" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="9" strokeLinecap="round" fill="none" />
        <circle cx="40" cy="14" r="11" fill="#ffffff" fillOpacity="0.6" />
        <circle cx="182" cy="118" r="13" fill="#ffffff" fillOpacity="0.75" />
        <circle cx="132" cy="186" r="10" fill="#ffffff" fillOpacity="0.45" />
        <circle cx="100" cy="100" r="30" fill="#ffffff" />
      </svg>
    );
  }

  const arcColors = variant === 'dark' ? ['#4338ca', '#6366f1', '#818cf8'] : ['#c7d2fe', '#a5b4fc', '#ddd6fe'];

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="seredina-core" x1="70" y1="70" x2="130" y2="130">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M100 100 C 60 88, 34 50, 40 14" stroke={arcColors[0]} strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 130 80, 168 84, 182 118" stroke={arcColors[1]} strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M100 100 C 84 138, 96 172, 132 186" stroke={arcColors[2]} strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="14" r="11" fill="#818cf8" />
      <circle cx="182" cy="118" r="13" fill="#a78bfa" />
      <circle cx="132" cy="186" r="10" fill="#c4b5fd" />
      <circle cx="100" cy="100" r="30" fill="url(#seredina-core)" />
    </svg>
  );
}
