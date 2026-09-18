import { describe, expect, it } from 'vitest';
import { OllamaAdapter } from './ollamaAdapter';

function fakeFetch(responseBody: unknown, capture: { request?: { url: string; body: unknown } }): typeof fetch {
  return async (url, init) => {
    capture.request = { url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : undefined };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const hasOllama = await fetch('http://localhost:11434/api/version')
  .then((r) => r.ok)
  .catch(() => false);

describe('OllamaAdapter', () => {
  it('prefixes the reported model with "ollama:" so pricing.ts can recognize it as free', async () => {
    const capture: { request?: { url: string; body: unknown } } = {};
    const adapter = new OllamaAdapter({
      baseURL: 'http://fake-ollama:11434/v1',
      model: 'llama3.1',
      fetch: fakeFetch(
        {
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1234567890,
          model: 'llama3.1',
          choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'ok', refusal: null } }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        },
        capture,
      ),
    });

    const result = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.model).toBe('ollama:llama3.1');
    expect(capture.request?.url).toContain('fake-ollama:11434/v1/chat/completions');
  });

  it('sends the same message shape as OpenAIAdapter (system + user)', async () => {
    const capture: { request?: { url: string; body: unknown } } = {};
    const adapter = new OllamaAdapter({
      baseURL: 'http://fake-ollama:11434/v1',
      fetch: fakeFetch(
        {
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1234567890,
          model: 'llama3.1',
          choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'ok', refusal: null } }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        },
        capture,
      ),
    });

    await adapter.complete({ system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }] });
    const body = capture.request?.body as { messages: unknown[] };
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
    ]);
  });

  // Real, not mocked -- runs only when a local Ollama instance is actually
  // reachable (this session's sandbox happens to have one, with a model
  // already pulled), same "skip if the live dependency isn't there" pattern
  // as this codebase's DATABASE_URL-gated integration tests.
  it.skipIf(!hasOllama)('completes a real prompt against a real local Ollama instance', async () => {
    const tags = await fetch('http://localhost:11434/api/tags').then((r) => r.json());
    const model = tags.models?.[0]?.name;
    if (!model) return; // no model pulled locally -- nothing to test against

    const adapter = new OllamaAdapter({ model });
    const result = await adapter.complete({
      system: 'Answer with just the number, nothing else.',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      maxTokens: 20,
    });

    expect(result.text).toContain('4');
    expect(result.model).toBe(`ollama:${model}`);
    // 3 minutes, not 30s -- Ollama unloads an idle model from memory after a
    // few minutes, and the resulting cold-load-plus-inference on a CPU-only
    // sandbox can genuinely take longer than even a generous timeout under
    // disk I/O contention, confirmed by hitting both 30s and 90s on an idle
    // model during this session -- immediately re-running the identical
    // call outside vitest afterward consistently completes in under 1s once
    // the model is warm, confirming this is a real hardware/timing
    // characteristic of local inference, not a bug in the adapter.
  }, 180_000);
});
