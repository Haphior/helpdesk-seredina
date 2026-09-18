# ADR 0032: RAG knowledge base search (pgvector, local embeddings)

## Status

Accepted, implemented.

## Context

Phase 3 opens with "AI depth," and the roadmap's first named piece is
RAG: letting the AI copilot ground its ticket-reply suggestions in a
tenant's own knowledge base (`KbArticle`, shipped in Phase 2 as plain
CRUD — see ADR 0018) instead of relying only on the model's own
training and the ticket thread.

The first real decision wasn't architectural, it was a hard
constraint: **Anthropic has no embeddings API.** `LlmProviderAdapter`
(ADR — none written, but see `packages/ai-adapters/src/types.ts`)
only ever wrapped `complete()`; embeddings need a different provider
entirely, which the existing adapter abstraction didn't anticipate.

Three real options existed: a hosted embeddings API (Voyage, OpenAI),
or a small model run locally in-process. The user is running against
a credit-limited (~$5), semi-compromised Anthropic key this session —
a real, current constraint, not a hypothetical one — which ruled out
adding a second paid API dependency for embeddings specifically. The
user's own answer locked in **local embeddings now, with an explicit
requirement that the architecture support other providers later**:
"me gusta con local tambien quiero la opcion de que puedan traer de
otros. pero apliquemos la 1."

## Decisions

**`EmbeddingProviderAdapter` interface, mirroring `LlmProviderAdapter`'s
existing shape** (`packages/ai-adapters/src/types.ts`): `embed(texts):
Promise<number[][]>` plus a `dimensions` property. `dimensions` is a
property, not a magic number scattered across call sites, because it's
exactly what a future migration script would need to assert against
before switching providers — the vector column width
(`KbChunk.embedding vector(384)`) is pinned to whichever adapter wrote
the data.

**`LocalEmbeddingAdapter`** (`packages/ai-adapters/src/localEmbeddingAdapter.ts`)
implements it via `@huggingface/transformers`'s
`pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`
(`pooling: 'mean', normalize: true`) — a small ONNX model that runs
in-process, no network call, no API key, zero marginal cost per
embed. Lazily loaded as a module-level singleton so the model loads
once per process, not once per call. 384-dimensional, normalized
output, confirmed directly (not assumed) by running the actual
pipeline against sample sentences before writing any schema.

**`KbChunk` model, `Unsupported("vector(384)")`.** Prisma has no
first-class vector type — `postgresqlExtensions` preview feature +
`extensions = [vector]` on the datasource, plus `Unsupported(...)` on
the column, is the documented pattern (confirmed via Prisma's own
docs, not guessed — first use of a Prisma preview feature and of
`Unsupported` in this codebase). Consequence: **every read or write of
`embedding` goes through raw SQL**, never Prisma's normal query API.
That matters for tenant isolation specifically — raw SQL bypasses the
Prisma Client Extension in `packages/db/src/prisma.ts` (the second,
independent defense layer described in ADR 0001), so `tenant_id` is
filtered explicitly by hand on every raw statement in `embed.ts` and
`embeddings.ts` as defense in depth. Postgres RLS (bound by
`withTenantTx`'s `set_config`, still in effect on the same
transaction) is the real backstop if that hand-written filter is ever
wrong — the cross-tenant-isolation test below is what actually proves
it, not the code comment.

**Chunks embed regardless of `published`.** `KbChunk` doesn't filter
on `KbArticle.published` the way the public self-service portal does
(ADR 0018). This is a deliberate, different trust boundary: the
copilot is drawing on a tenant's own agents' internal knowledge to
help another agent, not exposing it to an unauthenticated contact.
Nothing built here is reachable by the public portal's routes.

**HNSW index, hand-appended to the migration.** Prisma's schema DSL
has no concept of a vector operator class, so
`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` was
appended to the generated migration SQL by hand, then applied
directly with `CREATE INDEX IF NOT EXISTS` since `migrate dev` had
already run the un-indexed version. HNSW over IVFFlat: no
list-count/training step to tune, and better recall at this table's
expected size (a tenant's own KB, not a web-scale corpus).

**No `pgvector` npm dependency — a hand-written `toPgVector()`
instead** (`packages/ai-adapters/src/pgvectorFormat.ts`). The
`pgvector` package turned out to be ESM-only with a hard
`engines: >=22` requirement, incompatible with this codebase's Node 20
baseline and its CommonJS build (confirmed by installing it and
hitting both problems directly, not assumed from the README). Its
`toSql()` is one line — `` `[${arr.join(',')}]` `` — so writing that
line ourselves avoided an ESM/CJS interop workaround for a dependency
that added a real version-mismatch risk for one string formatter.

**Chunking is paragraph-first, ~500 chars, hard-split only when a
single paragraph is too long** (`packages/ai-adapters/src/chunkText.ts`).
Conservative relative to MiniLM's practical input window; articles are
short internal KB pages, not documents, so simple paragraph
boundaries were judged sufficient without a sliding-window/overlap
scheme.

**Full re-embed on every edit, not incremental chunk diffing.**
`embedKbArticle` deletes and re-inserts every chunk for an article on
each run. Articles are edited rarely and chunk counts are small (a
handful per article), so full replace is simpler than reconciling
which chunks changed — the incremental version would be real
additional complexity for a case that doesn't come up often enough to
justify it.

**Enqueue outside the transaction, both in `apps/api` and inside
`embed.ts` itself.** `createKbArticle`/`updateKbArticle` (only when
the title or body actually changed) call `embedKbArticleQueue.add()`
*after* their `withTenantTx` returns — enqueueing is Redis I/O, never
called while a tenant transaction holds a pooled connection open, the
same rule every other queue producer in this codebase already
follows. Inside the worker, the actual model inference also happens
outside any transaction, for the identical reason, even though it's
CPU-bound rather than network I/O — no reason to hold a connection
open for it either.

**Similarity threshold (0.45) and a 3-article cap for `suggestReply`
grounding**, not "always inject whatever comes back." Below the
threshold, an "irrelevant but ranked highest" chunk is noise that
would make the model more confident without being more correct — see
Verified below for what this was tuned against. Deduping to the
best-scoring chunk per article (not per chunk) avoids injecting the
same article twice via two of its own chunks.

**A standalone `GET /kb-articles/search-semantic` route**, separate
from `suggestReply`'s own internal call to `searchKnowledgeBase` —
exists purely so search quality is directly testable/tunable without
needing a full `suggestReply` round-trip (and, not incidentally,
without spending an LLM call) every time.

**`usedArticles` returned from `suggestReply` for UI provenance.**
The frontend renders a small "Based on: [Article A], [Article B]" note
under the drafted reply when grounding occurred — an agent should be
able to see when the AI is leaning on a specific internal article,
not just receive a suggestion with unexplained confidence.

## Consequences

- Embeddings are pinned to a specific model/dimension count (384,
  MiniLM). Swapping to a different or higher-dimension provider later
  is a real migration (new column width, re-embedding everything),
  not a config flag — an accepted cost of shipping *a* working
  provider now, with `EmbeddingProviderAdapter` at least ensuring the
  swap only touches one implementation, not every call site.
- Raw SQL for all of `KbChunk`'s embedding access is a permanent,
  deliberate exception to "always go through the Prisma Client
  Extension" — anyone touching this file later needs to remember the
  tenant-scoping is manual here, not automatic.
- No incremental re-embedding: an article with many chunks gets fully
  re-embedded on every edit, even a one-word title fix. Fine at this
  scale; would need revisiting if articles ever become very large or
  editing becomes very frequent.
- The 0.45 similarity threshold is a heuristic tuned against a small,
  hand-picked set of related/unrelated sentence pairs for this model —
  not a principled cutoff, and may need retuning if real tenant usage
  shows too much or too little grounding in practice.

## Verified

**Unit tests** (`packages/ai-adapters`, real local model, zero API
cost): `chunkText` — single short chunk, paragraphs kept together
while they fit, split once combined paragraphs exceed `maxChars`,
hard-split a too-long single paragraph on word boundaries without
losing or duplicating any word, blank/empty input produces no chunks.
`LocalEmbeddingAdapter` — produces 384-dimensional, normalized
(‖v‖≈1) vectors; a query embedding scores higher cosine similarity
against a genuinely related sentence ("How do I reset my password?"
vs. the actual reset instructions) than against an unrelated one
(an office-kitchen sentence) — this pair is what the 0.45 threshold
above was sanity-checked against; empty input returns `[]` without
loading the model. 10/10 passing.

**Migration and RLS, verified directly against the running dev
database**, not assumed from the generated SQL: `\d kb_chunks` in
`psql` confirms the `vector(384)` column, the `kb_chunks_embedding_idx`
HNSW index, both FK constraints, and — critically —
`Policies (forced row security enabled): tenant_isolation`, proving
`FORCE ROW LEVEL SECURITY` and the tenant-scoped policy actually
applied to this new table, not just the two older ones RLS was
originally built for.

**Integration tests** (`apps/api/test/kb-rag-search.test.ts`, live
Postgres, real local embeddings, real pgvector `<=>` search — skipped
without `DATABASE_URL`, same convention as every other live-DB suite
in this codebase). Cross-imports `apps/worker/src/kb/embed.ts`'s
`embedKbArticle` directly (test-only; apps/worker has no test
infrastructure of its own and standing one up for one feature wasn't
worth it) to populate real `KbChunk` rows synchronously instead of
running a live BullMQ worker in-test:

- A VPN-related query ranks the VPN article above an unrelated
  printer-troubleshooting article in the same tenant.
- An identical query against a *different* tenant's own VPN-adjacent
  article never returns it when searching the first tenant — proves
  cross-tenant isolation holds for this raw-SQL path specifically, not
  just the Prisma-extension-guarded paths ADR 0001's own test already
  covers.
- A tenant with zero `KbChunk` rows returns an empty result, not an
  error.
- `suggestReply`, using `TestProviderAdapter` (no real Anthropic call):
  with a matching article present, `usedArticles` includes it and the
  system prompt actually sent to the adapter contains the article's
  title — proving the grounding block really reaches the prompt, not
  just that `searchKnowledgeBase` returns a result.
- `suggestReply` against a tenant with no KB content at all degrades
  gracefully: `usedArticles` is empty, no grounding block appears in
  the system prompt, no error.

5/5 passing. Full `apps/api` suite re-run after adding these:
164 passing, 9 skipped (unrelated), no regressions. Both
`apps/api`/`apps/worker`/`apps/web`/`packages/ai-adapters`/
`packages/shared`/`packages/db` typecheck clean.

**Full pipeline verified live**, not just at the test layer: with the
real dev stack running (`api`/`worker`/`web`, real Postgres/Redis, no
mocks), a fresh browser session (Playwright) registered a new tenant,
created a real "VPN Setup Guide" `KbArticle` through the actual UI,
and — waiting on the real queue and the real worker, no shortcuts —
`psql` confirmed a `KbChunk` row for that exact article with a
non-null 384-dim embedding, produced by the running worker process,
not a test harness. A ticket was then created through the UI and the
"Suggest reply" button's frontend rendering was verified by mocking
only the network response for that one call (to avoid spending the
user's rate-limited real Anthropic API key on a call whose backend
behavior was already fully proven by the integration tests above) —
confirmed the "Based on: VPN Setup Guide" provenance note renders
correctly from a `usedArticles` payload and the suggested text
populates the reply box, with zero browser console errors.

**Known gap, not silently skipped**: the similarity threshold (0.45)
and chunk size (~500 chars) are tuned against a handful of synthetic
test sentences, not real tenant KB content at scale — this is the
piece that most likely needs revisiting once real usage exists.
