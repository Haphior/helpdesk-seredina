import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicAdapter, OllamaAdapter, OpenAIAdapter } from '@seredina/ai-adapters';
import { getAiAdapter } from '../src/modules/ai/adapter';

/**
 * No live DB/Redis needed -- this is pure env-var-driven selection logic, see
 * modules/ai/adapter.ts and docs/adr/0034-second-llm-provider-and-autonomous-loop.md.
 */
describe('getAiAdapter provider selection', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns null with nothing configured', () => {
    expect(getAiAdapter()).toBeNull();
  });

  it('defaults to Anthropic when only ANTHROPIC_API_KEY is set (backward compatible, no AI_PROVIDER)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(getAiAdapter()).toBeInstanceOf(AnthropicAdapter);
  });

  it('AI_PROVIDER=openai requires OPENAI_API_KEY, returns null without it', () => {
    process.env.AI_PROVIDER = 'openai';
    expect(getAiAdapter()).toBeNull();
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(getAiAdapter()).toBeInstanceOf(OpenAIAdapter);
  });

  it('AI_PROVIDER=ollama needs no API key at all', () => {
    process.env.AI_PROVIDER = 'ollama';
    expect(getAiAdapter()).toBeInstanceOf(OllamaAdapter);
  });

  it('AI_PROVIDER=anthropic without a key returns null even if it was the default before', () => {
    process.env.AI_PROVIDER = 'anthropic';
    expect(getAiAdapter()).toBeNull();
  });

  it('an unrecognized AI_PROVIDER value disables AI rather than throwing', () => {
    process.env.AI_PROVIDER = 'not-a-real-provider';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(getAiAdapter()).toBeNull();
  });
});
