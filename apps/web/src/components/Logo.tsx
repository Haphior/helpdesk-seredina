// The mark: three unequal, overlapping circles -- "Seredina" (середина) is
// Slavic for "the middle," and the product's job is literally this: email,
// API calls, and NOC/SOC alerts (the three real values of Ticket.channel)
// arrive as separate things and overlap into one shared ticket. The blended
// center where all three overlap IS "the middle" -- the brand story told
// through the overlap itself, not a line pointing at it.
//
// Replaced the original three-arc "hub and spoke" mark 2026-09-16: besides
// external feedback that the arcs' arrangement risked an accidental
// anatomical read, three semi-transparent filled circles have a structural
// advantage the arcs never did -- there is no stroke, no line endpoint, and
// no favicon-only micro-glyph needed. Verified by rendering this exact
// geometry at 128/64/32/16px before adopting it: it holds up at every size
// on nothing but fill opacity, where the arc mark needed a whole separate
// dedicated shape below 32px (see git history / docs/adr for that mark's
// public/favicon.svg treatment, now replaced by this same geometry).
//
// 'onLightBg' (default) and 'onDarkBg' are named for WHERE the mark sits,
// not the shade of its own fill -- see the prior mark's naming-bug postscript
// for why that distinction matters. 'mono' is unchanged in spirit: solid
// white at varying opacity, for the saturated indigo/violet brand panel
// itself (Login/Register) where the full-color gradient would blend into a
// same-hue background instead of standing out.
type LogoVariant = 'onLightBg' | 'onDarkBg' | 'mono';

export function Logo({ size = 32, variant = 'onLightBg' }: { size?: number; variant?: LogoVariant }) {
  if (variant === 'mono') {
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="78" cy="88" r="52" fill="#ffffff" fillOpacity="0.5" />
        <circle cx="128" cy="72" r="42" fill="#ffffff" fillOpacity="0.7" />
        <circle cx="112" cy="132" r="46" fill="#ffffff" fillOpacity="0.85" />
      </svg>
    );
  }

  // onLightBg: saturated indigo/violet -- for the white/slate-50 surfaces
  // this is actually used on (nav sidebar). onDarkBg: a paler set, reserved
  // for a dark surface that isn't the saturated mono panel (nothing uses
  // this yet).
  const colors = variant === 'onLightBg' ? ['#818cf8', '#6366f1', '#8b5cf6'] : ['#c7d2fe', '#a5b4fc', '#ddd6fe'];

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="78" cy="88" r="52" fill={colors[0]} fillOpacity="0.88" />
      <circle cx="128" cy="72" r="42" fill={colors[1]} fillOpacity="0.88" />
      <circle cx="112" cy="132" r="46" fill={colors[2]} fillOpacity="0.9" />
    </svg>
  );
}
