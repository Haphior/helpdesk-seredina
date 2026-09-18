# ADR 0041: App-wide UI quality pass — shared primitives, accessibility fixes, interface-guideline compliance

## Status

Accepted, implemented.

## Context

`docs/DESIGN_SYSTEM.md` documented a real, deliberate design system, but it had only ever been *applied* to the 4 "highest-traffic" screens from the original redesign pass (Tickets, Ticket Detail, Login, Register). Every other page — roughly 30 of them — was explicitly flagged in that doc as "not yet reviewed... a reasonable next pass, not yet done." This ADR is that pass: bring every page onto the same visual language, extract the shared primitives that never existed, and apply the public "Vercel Interface Guidelines" checklist (interfaces.rauno.me — Rauno Freiberg's widely-cited interactivity/typography/motion/touch/accessibility checklist) as a concrete, non-generic quality bar rather than vague "make it nicer" polish.

Used the `impeccable` design skill (github.com/pbakaus/impeccable, npm) as tooling throughout — installed locally only (gitignored: `.claude/skills/impeccable/`, `.claude/settings.local.json`, `.impeccable/`), per an explicit decision that this is tooling for doing the work, not something other contributors need installed.

## Findings (evidence gathered before any edit, not assumptions)

- **No `Button`, `Input`, `Select`, `Table`, or `Card` primitive existed anywhere.** `packages/ui` is an empty placeholder. Every page hand-rolled these with inline Tailwind.
- **Confirmed drift from duplication**: the primary-button string (`rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700`) was duplicated across 10+ files with visible drift already (some using `rounded-md`/`text-sm` instead). The card shell (`rounded-xl border border-slate-200 bg-white p-4 shadow-sm`) was duplicated verbatim in multiple files.
- **Real accessibility regressions**: `focus:outline-none` with no replacement focus indicator existed in 4 places (`Assets.tsx`, `TicketDetail.tsx` ×2, `TicketsQueue.tsx`) — keyboard focus was invisible there, worse than the browser default. Zero `aria-label` existed on any icon-only button inside `pages/*.tsx`. `Modal.tsx` (used by 17 files) didn't trap focus or restore it on close.
- **A latent SLA bug, found by code inspection, not a test failure**: unrelated to this pass's direct scope but discovered while reviewing `addMessage` — already fixed in an earlier pass this session (see the widget ADR); not re-litigated here.

## Decisions

**New shared primitives in `apps/web/src/components/`** (not `packages/ui`, which is an unrelated future placeholder): `Button.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`, `Card.tsx`. Each bakes in the relevant Rauno-checklist items once instead of leaving every call site to remember them:
- **Compile-time label enforcement.** `Button`'s `iconOnly` and `Input`/`Select`/`Textarea`'s `hideLabel` are discriminated unions requiring `aria-label` when true — an unlabeled icon-only button or hidden-label input fails to *compile*, not just a later audit.
- **Real focus rings via `box-shadow`** (Tailwind `ring-*`), never a bare `outline` removal with nothing replacing it.
- **`isLoading` on `Button`** ties the loading state and the disabled state together so a caller can't forget to guard against a duplicate submit.
- **16px input font-size** (shrinking back to the app's usual 13.5px at the `sm` breakpoint) — below 16px, iOS Safari zooms the page on focus; this is the one property that actually controls that behavior.
- **Icon-only sizing uses its own disjoint class set** (`ICON_ONLY_SIZES`), not the regular padding classes with an override appended after — two Tailwind utilities touching the same CSS property in one template string land in the generated stylesheet in an order that depends on Tailwind's internals, not on source order, so a later class in the string is not reliably an override. Keeping them disjoint per size avoids ever depending on that.
- **Touch targets are 36px by default**, not the usual 44px guideline — this is a dense, desktop-first admin console (see `docs/PRODUCT.md`'s ICP), and 44px everywhere would visibly bloat a toolbar meant to be scanned at a desk. `size="lg"` (44px) is available and used on the pages actually meant to work well from a phone (`PublicKb`).

**`Modal.tsx` fixed in place**: added a real focus trap (Tab/Shift+Tab cycles within the dialog, Escape closes it) and focus restoration to the trigger element on close, using the DOM's own focusable-element query rather than a new dependency.

**`docs/DESIGN.md` (new)**: a machine-readable token extraction (colors, typography, spacing, components) in the DESIGN.md spec format, generated from the existing `docs/DESIGN_SYSTEM.md` and the actual Tailwind config rather than a fabricated creative-language interview — this exists so the `impeccable` design-detector hook has real tokens to check drift against, not to drive a live design panel. `docs/DESIGN_SYSTEM.md` stays the primary human-facing reference; `DESIGN.md` is kept in sync with it. Two real, recurring type-scale gaps found during the sweep (an 11.5px uppercase table-caption size and a 15px section-subhead size, each reused across many files) were added to the ramp rather than left as permanent advisory noise for something that was already a real, intentional pattern.

**Swept every page**, batched by `Layout.tsx`'s existing nav groups (Work, CMDB, Configuration, Operations, Administration) plus the public-facing pages (`PublicKb`, `PublicKbArticle`, `PublicStatus`) and a lighter pass on the 4 already-redesigned screens (adopted the new primitives where they hand-rolled the same thing; fixed their 3 focus-ring gaps; left `PropertyRow`/`PropertySelect` in `TicketDetail.tsx` untouched — already a good, established pattern). Each batch was typechecked and detector-scanned before moving to the next.

**Suppressed the one confirmed false positive** the full-app detector scan found (`AuthLayout.tsx`'s indigo→violet gradient, flagged as the generic "AI color palette" anti-pattern) via a file-scoped `ignore-value` with a named reason (`docs/BRAND.md` + `docs/DESIGN_SYSTEM.md`'s own "don't introduce a third accent hue" rule) rather than diluting a real, deliberate brand choice to satisfy a generic heuristic.

## Consequences

- **A real regression was caught by live verification, not by the detector**: `SlaPolicies.tsx`'s narrow (`w-20`) minute inputs clipped their own placeholder text once `Input`'s 16px mobile font-size applied — fixed by widening the containers and shortening the placeholder. This is exactly why the plan called for Playwright screenshots as real verification, not just a typecheck and a mechanical detector scan: neither would have caught a placeholder clipping inside a specific fixed-width layout.
- **`Table`/row-grid extraction was explicitly deferred**, not forgotten — `TicketsQueue.tsx`'s CSS-grid row pattern is reusable as a pattern but converting it carried more risk than the primitives that shipped, for less certain benefit. A future pass can revisit it.
- **Two large, already-good files (`TicketsQueue.tsx`, `TicketDetail.tsx`) intentionally did not get a full primitive rewrite** — only their concrete bugs (focus rings) and their most duplicated controls (the primary "New ticket" button, the search input). Forcing every existing input/select in a 900-line file that already works into the new primitives was judged lower value than the rest of this pass, consistent with the plan's own "lighter pass" scoping for these four screens.

## Verified

**Every batch typechecked clean** (`npx tsc --noEmit` on `apps/web`) before moving to the next, and a final full production build (`npm run build`) succeeded with no errors or warnings.

**`impeccable detect` across the entire `apps/web/src` tree**: 0 anti-patterns (the one real finding — the AuthLayout gradient — is the confirmed, suppressed false positive above). A handful of advisory-only notes remain (pre-existing arbitrary font sizes not otherwise reused enough to warrant a new ramp entry); advisory findings never block anything and are disclosed, not silently ignored.

**Real, live, end-to-end in a running Chromium browser — not just a typecheck**: registered a fresh tenant, logged in, and screenshotted all 26 authenticated pages plus the 3 public pages at desktop width with zero browser console errors across all of them. Specifically verified: the search input's new focus ring actually renders (`box-shadow` present via `getComputedStyle`, confirmed empty/absent before this pass); `Modal`'s focus trap moves focus into the dialog on open (`document.activeElement` contained within `[role="dialog"]`, confirmed via direct DOM inspection, not just visual inspection); the placeholder-clipping regression above was caught by screenshot, fixed, and re-verified by a second screenshot; the most complex modal in the app (`ProcessTemplates`'s multi-section conditional form) renders correctly with the new primitives composed together (radio group, nested conditional sections, dynamic step list).
