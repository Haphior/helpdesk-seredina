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

Three unequal arcs curving into one solid center point (`apps/web/src/components/
Logo.tsx`, favicon at `apps/web/public/favicon.svg`). Deliberately **asymmetric**
— different arc lengths and curvatures, three differently-sized source dots — so
it reads as this one specific idea (unequal things resolving into a middle point)
rather than a generic symmetric spoke-and-hub, which is a shape shared by a huge
swath of tech/network logos.

An early viewer read it as "a hand waving hello, reaching out to help" before
being told the etymology. That's not the mark's original premise — it was
designed around "convergence" — but it's a genuinely good second reading for a
helpdesk brand and worth keeping in mind rather than designing away. Both readings
point the same direction: something (or someone) reaching toward a center to help.

Three variants (`variant` prop): `light`/`dark` (full color, for a white or
slate/navy surface — nav, cards) and `mono` (solid white at varying opacity, for
the saturated indigo/violet brand panel itself, where the full-color gradient core
would blend into a same-hue background instead of standing out). Never place the
`light`/`dark` full-color mark directly on the indigo/violet brand gradient — use
`mono` there, as `AuthLayout.tsx` does.

Four other directions were explored and set aside (a ticket-tag shape, twin
speech-bubbles forming an "S", a shield-with-checkmark, a symmetric node-hub) —
each leaned on a visual cliché already common in this product category (ticket
tags, chat bubbles, shields, network hubs). The convergence mark was chosen
specifically because it's the one idea genuinely tied to this product's name and
mechanism, not swappable with a competitor's logo.

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

## Where this shows up

- `apps/web/src/components/Logo.tsx` — the mark, all three variants
- `apps/web/public/favicon.svg` — browser tab icon
- `apps/web/index.html` — page `<title>`
- `docs/PRODUCT.md` — the "meet in the middle" positioning (NOC/SOC integrate-not-
  replace) predates this doc and is the mechanism half of the tagline's meaning
