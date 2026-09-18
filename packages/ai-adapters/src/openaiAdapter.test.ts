import { describe, expect, it } from 'vitest';
import { OpenAIAdapter } from './openaiAdapter';

/**
 * No real OpenAI API key is available in this environment, so this verifies
 * the adapter against a fake `fetch` (the SDK's own documented seam) that
 * returns a real Chat Completions response shape -- confirming the request
 * this adapter builds and how it parses the response, without a network call.
 */
function fakeFetch(responseBody: unknown, capture: { request?: { url: string; body: unknown } }): typeof fetch {
  return async (url, init) => {
    capture.request = { url: url.toString(), body: init?.body ? JSON.parse(init.body as string) : undefined };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('OpenAIAdapter', () => {
  it('sends system+user messages and max_completion_tokens, parses usage and text back out', async () => {
    const capture: { request?: { url: string; body: unknown } } = {};
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4.1',
      fetch: fakeFetch(
        {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4.1',
          choices: [
            { index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'Hi there!', refusal: null } },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        },
        capture,
      ),
    });

    const result = await adapter.complete({
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'Say hi' }],
      maxTokens: 100,
    });

    expect(result.text).toBe('Hi there!');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(4);
    expect(result.model).toBe('gpt-4.1');

    expect(capture.request?.url).toContain('/chat/completions');
    const body = capture.request?.body as { messages: unknown[]; max_completion_tokens: number };
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Say hi' },
    ]);
    expect(body.max_completion_tokens).toBe(100);
  });

  it('omits the system message entirely when none is given', async () => {
    const capture: { request?: { url: string; body: unknown } } = {};
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      fetch: fakeFetch(
        {
          id: 'chatcmpl-124',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4.1',
          choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'ok', refusal: null } }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        },
        capture,
      ),
    });

    await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });

    const body = capture.request?.body as { messages: unknown[] };
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('defaults inputTokens/outputTokens to 0 rather than throwing when usage is missing', async () => {
    const capture: { request?: { url: string; body: unknown } } = {};
    const adapter = new OpenAIAdapter({
      apiKey: 'test-key',
      fetch: fakeFetch(
        {
          id: 'chatcmpl-125',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4.1',
          choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'ok', refusal: null } }],
        },
        capture,
      ),
    });

    const result = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });
});
