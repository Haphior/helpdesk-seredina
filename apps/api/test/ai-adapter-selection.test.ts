import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicAdapter, OllamaAdapter, OpenAIAdapter } from '@seredina/ai-adapters';
import { getAiAdapter } from '../src/modules/ai/adapter';

/**
 * getAiAdapter now checks for a tenant-specific TenantAiSettings row first
 * (Phase 4 BYOK, see docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md)
 * before falling back to the deployment-wide env vars this test suite
 * originally covered -- that lookup needs a live DB even for a tenant with
 * no such row (an empty result, not an error), so this suite now carries the
 * same DATABASE_URL skip guard as this codebase's other live-Postgres
 * suites. A fresh random UUID with no real Tenant row is enough: the
 * TenantAiSettings lookup returns null (no matching row) regardless of
 * whether the tenant itself exists, exercising exactly the "no
 * tenant-specific config -- fall back to deployment-wide" path these tests
 * are actually about.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('getAiAdapter provider selection', () => {
  const ORIGINAL_ENV = { ...process.env };
  let tenantId: string;

  beforeEach(() => {
    tenantId = randomUUID();
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns null with nothing configured', async () => {
    expect(await getAiAdapter(tenantId)).toBeNull();
  });

  it('defaults to Anthropic when only ANTHROPIC_API_KEY is set (backward compatible, no AI_PROVIDER)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(await getAiAdapter(tenantId)).toBeInstanceOf(AnthropicAdapter);
  });

  it('AI_PROVIDER=openai requires OPENAI_API_KEY, returns null without it', async () => {
    process.env.AI_PROVIDER = 'openai';
    expect(await getAiAdapter(tenantId)).toBeNull();
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(await getAiAdapter(tenantId)).toBeInstanceOf(OpenAIAdapter);
  });

  it('AI_PROVIDER=ollama needs no API key at all', async () => {
    process.env.AI_PROVIDER = 'ollama';
    expect(await getAiAdapter(tenantId)).toBeInstanceOf(OllamaAdapter);
  });

  it('AI_PROVIDER=anthropic without a key returns null even if it was the default before', async () => {
    process.env.AI_PROVIDER = 'anthropic';
    expect(await getAiAdapter(tenantId)).toBeNull();
  });

  it('an unrecognized AI_PROVIDER value disables AI rather than throwing', async () => {
    process.env.AI_PROVIDER = 'not-a-real-provider';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(await getAiAdapter(tenantId)).toBeNull();
  });
});
