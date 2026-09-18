import { describe, expect, it } from 'vitest';
import { chunkText } from './chunkText';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('Reset your password from the login screen.');
    expect(chunks).toEqual(['Reset your password from the login screen.']);
  });

  it('keeps whole paragraphs together while they fit', () => {
    const text = 'Paragraph one.\n\nParagraph two.';
    expect(chunkText(text, 100)).toEqual(['Paragraph one.\n\nParagraph two.']);
  });

  it('splits into multiple chunks once combined paragraphs exceed maxChars', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const chunks = chunkText(`${a}\n\n${b}`, 50);
    expect(chunks).toEqual([a, b]);
  });

  it('hard-splits a single paragraph longer than maxChars on word boundaries', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(words, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
    expect(chunks.join(' ')).toBe(words);
  });

  it('ignores blank paragraphs and empty input', () => {
    expect(chunkText('\n\n\n')).toEqual([]);
    expect(chunkText('')).toEqual([]);
  });
});
