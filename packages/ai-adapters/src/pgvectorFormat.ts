/**
 * Formats a JS number array as a Postgres pgvector literal for use inside a
 * `$queryRaw`/`$executeRaw` tagged template with an explicit `::vector` cast --
 * see docs/adr/0032-rag-knowledge-base-search.md. Written by hand rather than
 * depending on the `pgvector` npm package: that package is ESM-only with a
 * hard `engines: >=22` requirement (this codebase targets Node 20), and the
 * format itself is this one line -- not worth an ESM/CJS interop workaround for.
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
