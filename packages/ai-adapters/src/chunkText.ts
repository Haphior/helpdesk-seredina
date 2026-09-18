const DEFAULT_MAX_CHARS = 500;

/**
 * Paragraph-first chunking for RAG embedding (see
 * docs/adr/0032-rag-knowledge-base-search.md). Splits on blank lines first,
 * so a chunk boundary lands on a natural break whenever possible; a
 * paragraph longer than maxChars is hard-split on word boundaries instead of
 * being embedded as one oversized chunk. maxChars defaults conservatively
 * relative to MiniLM's practical input window, not its hard token limit.
 */
export function chunkText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > maxChars ? splitLongParagraph(paragraph, maxChars) : [paragraph];

    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > maxChars && current) {
        chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const words = paragraph.split(/\s+/);
  const pieces: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}
