import type { CompleteInput, CompleteResult, LlmProviderAdapter } from './types';

/**
 * Deterministic double for tests and for local dev without an Anthropic API key --
 * never talks to a network. Queue responses with the constructor array (consumed
 * in order); once empty, falls back to a fixed placeholder so a test that doesn't
 * care about the exact text still gets a stable result. Every call is recorded so
 * a test can assert on the prompt a service function actually built.
 */
export class TestProviderAdapter implements LlmProviderAdapter {
  private queue: string[];
  private calls: CompleteInput[] = [];

  constructor(responses: string[] = []) {
    this.queue = [...responses];
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    this.calls.push(input);
    const text = this.queue.shift() ?? '[test response]';
    return { text, inputTokens: text.length, outputTokens: text.length, model: 'test-model' };
  }

  getCalls(): CompleteInput[] {
    return this.calls;
  }
}
