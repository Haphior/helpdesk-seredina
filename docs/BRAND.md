# Seredina — Brand

The "generate a brand doc" checklist item, full scope (name story, logo, voice) per
the user's choice. Builds on [docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (typography/
color/UI components) rather than repeating it — this doc is identity, that one is
interface.

## Name

**Seredina** (середина) is the Slavic word for "the middle" — the point where
things converge. Flagged as a working assumption when this was named, not confirmed
etymology; correct this section if the name meant something else.

The meaning fits by accident-that-isn't-really-an-accident: the product's actual
job is to be the middle — email, the API channel, and NOC/SOC alerts (Zabbix,
Wazuh, Grafana, ...) all arrive from different places and converge into one
ticket. English even hands us a matching idiom for the tagline ("meet in the
middle") that lines up with the Slavic meaning without forcing it.

## Logo

Three unequal, semi-transparent, overlapping circles (`apps/web/src/components/
Logo.tsx`, favicon at `apps/web/public/favicon.svg` — identical geometry in both,
unscaled). The blended center where all three overlap *is* "the middle" — the
name's meaning told through the overlap itself, not a line pointing at it.
Concretely, the three circles are the three real values of `Ticket.channel`
(email, API, monitoring alert): separate things that land in one shared ticket.

Replaced 2026-09-16. The original mark (three unequal arcs curving into one
center point, kept in git history) was dropped for two reasons: external
feedback flagged the specific arrangement of its three arms as an accidental
anatomical read (verified as a real, geometry-level issue — two arms clustered
tightly on one side, one alone on the other — not just a subjective complaint),
and even after re-angling to fix that, arcs have a structural cost circles don't:
a stroke has a line endpoint that drops below 1px at small sizes, which is why
that mark needed a second, dedicated "micro-glyph" shape just for the favicon.
Three filled circles need no such adaptation — verified by rendering the exact
same markup at 128/64/32/16px before adopting it, holding up at every size on
fill opacity alone.

Explored and set aside before landing here, across several rounds: the original
arcs re-angled in place; a keystone/arch, a fulcrum/balance-beam, a suture, and
an interlocking-halves mark (each tied to a specific "the middle" metaphor, tried
because the first round leaned on common icon patterns); and — because an early
viewer's "hand waving hello" reading of the original arcs was worth building
toward on purpose — a confident abstract wave, a full mascot ("Seri," with a
headset variant), and two hands meeting at the center. All were real, rendered
candidates, not just described; overlapping circles won on the combination of
being the most structurally sound (no small-size adaptation needed) and the most
concretely tied to the product's actual channel model, not just the name.

Three variants (`variant` prop): `onLightBg` (default — saturated indigo/violet,
for the white/slate-50 surfaces this is actually used on, i.e. the nav sidebar),
`onDarkBg` (a paler set, reserved for a dark surface that isn't the saturated
mono panel — nothing uses this yet), and `mono` (solid white at varying opacity,
for the saturated indigo/violet brand panel itself, where the full-color version
would blend into a same-hue background instead of standing out). Never place
`onLightBg`/`onDarkBg` directly on the indigo/violet brand gradient — use `mono`
there, as `AuthLayout.tsx` does. (The variant names themselves were fixed from
`light`/`dark` — those described the *shade* of the mark's own fill, not *where*
it sits, which is how the pale, low-contrast set had ended up shipped on the
white sidebar at one point. `onLightBg`/`onDarkBg` describe placement instead.)

## Tagline

**"Open-source ITSM that meets you in the middle."** Leans on the idiom rather
than explaining the etymology in-product — nobody reads a tagline as a language
lesson. Works both as "we integrate rather than replace your NOC/SOC" (a very
literal middle-ground stance, see `docs/PRODUCT.md`) and as the friendlier "we
meet you where you are" reading.

Alternates, kept as options rather than picked because none beat the above outright:
- "Where every signal meets a hand ready to help." (leans fully into the
  waving-hello reading; warmer, less literal about the product mechanism)
- "The middle point where IT gets resolved." (most literal; flattest)

## Voice and tone

1. **Direct and honest, including about limits.** This is already how the project
   documents itself (ADRs record what failed against a real server, the ROADMAP
   lists deferred items instead of hiding them) — brand voice should match, not
   invent a more confident-sounding marketing register that the docs then
   contradict. Say what's built and verified; say plainly what isn't yet.
2. **Warm, not stiff.** The mark waves hello — copy should read like a capable
   colleague explaining something, not a legal disclaimer or a hype deck. Short
   sentences, plain words, contractions are fine.
3. **Specifics over superlatives.** No "revolutionary," "game-changing," "best-in-
   class." A real ADR reference or a real verification note is more persuasive
   than an adjective, and it's the kind of claim a technical ICP (see
   `docs/PRODUCT.md#icp`) actually trusts.
4. **Vary sentence connectors — don't default to the em dash.** Reviewed against a
   "how to spot a vibe-coded app" checklist (2026-09): the em dash-as-default-
   connector is a recognizable AI-writing tic, present enough in this UI's own
   copy at the time (`Login.tsx`, `Register.tsx`, `ApiKeys.tsx`, `Users.tsx`,
   `Assets.tsx`) that it was worth fixing, not just noting. A period, a colon, or
   just rewriting the sentence works as well and reads less like every helper
   string came out of the same template. Not a total ban — the copyright line
   (`© Seredina — AGPL-3.0`) keeps its dash, that's an idiomatic convention, not a
   sentence connector — just don't reach for it by default.

## Anti-patterns checked against (2026-09 audit)

Reviewed the UI against a "signs your app was vibe-coded" list someone sent the
team. Most were already avoided by earlier decisions in this doc and
`docs/DESIGN_SYSTEM.md` (Plus Jakarta Sans instead of Inter/Space Grotesk, no
Lucide/shadcn, no glassmorphism, no gradient text, no emoji, no colored-left-
border cards, no generic buzzword copy, no icon-grid/badge-above-headline
patterns — the app has no marketing landing page yet, only product screens). Two
real hits, fixed: the em-dash tic above, and `Modal.tsx`'s close button was a
literal `✕` text character instead of an SVG icon like everything else in
`icons.tsx` (now `CloseIcon`). The indigo→violet gradient on the login/register
brand panel and logo core was checked deliberately, not reflexively kept: it's
scoped to exactly those two places, tied to the logo's own "convergence" premise
(see above), not a decorative hero-section fill — kept as-is, not the generic
"purple-to-blue gradient" this kind of checklist is warning about, but worth
re-checking if it ever spreads to a third place without a reason.

## Where this shows up

- `apps/web/src/components/Logo.tsx` — the mark, all three variants
- `apps/web/public/favicon.svg` — browser tab icon
- `apps/web/index.html` — page `<title>`
- `docs/PRODUCT.md` — the "meet in the middle" positioning (NOC/SOC integrate-not-
  replace) predates this doc and is the mechanism half of the tagline's meaning
