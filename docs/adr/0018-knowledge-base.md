# ADR 0018: Knowledge Base — plain CRUD first, pulled forward from Phase 3

## Status

Accepted, implemented.

## Context

Flagged in the roadmap as "a real gap, not a duplicate of Phase 3's RAG
plan": `KbArticle` needs to exist as a plain, human-browsable CRUD resource
*before* anything AI-related touches it. Phase 3's `pgvector` embeddings and
`search_knowledge_base` tool should be an enhancement layered onto these same
rows later, not the reason they exist — "a knowledge base that only an AI
can query isn't a knowledge base a support team can maintain or trust." Worth
building now rather than waiting for Phase 3, given how consistently "the KB
is incomplete/impossible to search live" showed up as a real agent pain
point in the competitive research pass.

## Decisions

**`KbArticle.body` is plain text, not markdown.** No markdown parser exists
anywhere in this codebase yet (`Message.body` renders the same way); adding
one just for the KB would be new surface unrelated to this ADR's actual job.
Rendered with `whitespace-pre-wrap`, matching `Message.body`'s existing
convention exactly.

**`slug` is derived from `title` once, at creation, and never changes
afterward** — even if the title is edited later. It's the one stable,
URL-safe identifier the public portal links to; letting it drift with the
title would break every bookmark and inbound link to that article the moment
someone fixed a typo in the headline. Collision handling appends `-2`, `-3`,
... rather than rejecting a duplicate title outright — unlike `ServiceCatalogItem`
or `ProcessTemplate`, which do reject duplicate names, article titles
("Password Reset," written twice a year apart by two different agents) are
expected to collide sometimes, and forcing every rewrite to invent a unique
title would be real friction for no benefit.

**`published: Boolean`, defaulting to `false`.** A half-written draft must
never be reachable from the public portal by default; publishing is an
explicit, later action. The two public-facing service functions
(`listPublishedKbArticles`, `getPublishedKbArticleBySlug`) filter
`published: true` themselves, rather than trusting every future caller to
remember to check it — the same "don't rely on the caller" posture as
`AutonomyPolicy`'s default-deny elsewhere in this codebase's design.

**The public self-service portal is genuinely unauthenticated**, resolving
which tenant via `resolveTenantIdBySlug()` — the exact mechanism
login/register already use to go from "no tenant context yet" to one (a
Postgres `SECURITY DEFINER` function exposing only a slug→id lookup; see
`modules/tenants/service.ts`). This is the right mechanism because a Contact
has no Seredina account to log into at all (only Users/agents authenticate)
— building a separate "contact login" system just to gate KB reads would
have been a much bigger feature than this ADR's actual scope. Both public
routes 404 identically for "no such tenant" and "no such article (or it's a
draft)" — an unauthenticated caller should never be able to distinguish
those two cases by response shape, which would otherwise leak which article
slugs exist in draft form.

**Permission tiers put reading AND writing the knowledge base at
`tickets:read`/`tickets:write`**, not `tickets:manage_all` the way
`CustomFieldDefinition` or `ProcessTemplate` creation is gated. A KB article
is content any agent should be able to contribute, closer in spirit to a
macro being *applied* than to a macro being *defined* — restricting authorship
to admins would undermine the exact "a support team can maintain" framing
this ADR opens with.

**The internal admin page and the public portal are visually and
structurally separate**, not the same component with a public/private flag.
`KnowledgeBase.tsx` lives inside the authenticated `Layout` shell (sidebar,
`useAuth`); `PublicKb.tsx`/`PublicKbArticle.tsx` are bare, centered pages
registered as siblings of `/login`/`/register` in `App.tsx`, outside
`RequireAuth` entirely. Sharing one component with conditional chrome would
have risked exactly the kind of accidental leak (an internal-only control
rendering on the public page because a permission check was missed) this
feature most needs to avoid.

## Verified

8 new integration tests against real Postgres (`apps/api/test/kb.test.ts`):
a new article defaults to unpublished with a slug derived from its title; a
repeated title gets a deduped `-2` slug instead of colliding; editing the
title never changes the already-assigned slug; search matches by title or
body, case-insensitively; the public functions never return an unpublished
draft, whether by list or by direct slug lookup; publishing toggles an
article into the public list without touching its slug;
`resolveTenantIdBySlug` correctly resolves this tenant and returns null for
a nonexistent one; delete works and a second delete is rejected. Full suite
73/73 passing (9 skipped, unrelated), both `apps/api`/`apps/web` typecheck
clean.

Browser-verified end to end against the real running app: created a draft
and a published article from the admin Knowledge Base page, confirmed
search finds an article by body text, then — in a **separate, unauthenticated
browser context** (no token, no cookies) — visited the public portal at
`/kb/<tenantSlug>`, confirmed the draft article never appears in that list,
opened the published article and read its body, and confirmed both public
routes return a clean 404 for a draft's slug and for a nonexistent tenant
slug. Zero console errors throughout.

## Consequences / known v1 limitations

- No `pgvector` embeddings or `search_knowledge_base` AI tool yet — that's
  Phase 3's job, deliberately layered on top of these same rows rather than
  being the reason they exist, per this ADR's own framing.
- Search is a plain case-insensitive `contains` on title/body, not full-text
  ranking — adequate for "find the one article about VPN," not for a large
  KB with hundreds of overlapping articles.
- No article categories/tags, no rich-text/image embedding, no version
  history — matches this codebase's established minimalism for a first
  pass (Custom Fields, Macros, and Service Catalog all shipped without
  these too).
- No contact-specific personalization (e.g. showing KB suggestions relevant
  to a contact's open ticket) — the portal is a flat, searchable list, not
  yet wired into the ticket-creation or contact-facing flow at all.
