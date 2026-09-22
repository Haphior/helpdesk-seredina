import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { AnthropicAdapter, OllamaAdapter } from '@seredina/ai-adapters';
import { getAiAdapter } from '../src/modules/ai/adapter';
import { clearTenantAiSettings, getResolvedTenantAiConfig, getTenantAiSettings, updateTenantAiSettings } from '../src/modules/ai/settings';

/**
 * Phase 4 bring-your-own-AI-key -- see
 * docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md. Live
 * Postgres (real encrypt/decrypt round-trip against a real row), same skip
 * convention as this codebase's other DATABASE_URL-gated suites.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Tenant AI settings (BYOK)', () => {
  let tenantId: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `byok-${tenantId.slice(0, 8)}`, name: 'BYOK Tenant' } }),
    );
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('a fresh tenant has no AI settings and never exposes a key', async () => {
    const settings = await getTenantAiSettings(tenantId);
    expect(settings).toEqual({ provider: null, hasApiKey: false, model: null, baseUrl: null });
  });

  it('setting a provider+key never returns the key itself, only hasApiKey', async () => {
    const settings = await updateTenantAiSettings(tenantId, { provider: 'openai', apiKey: 'sk-real-secret-value', model: 'gpt-4.1' });
    expect(settings.provider).toBe('openai');
    expect(settings.hasApiKey).toBe(true);
    expect(settings.model).toBe('gpt-4.1');
    expect(JSON.stringify(settings)).not.toContain('sk-real-secret-value');
  });

  it('the key round-trips through real AES-256-GCM encryption, not just a flag', async () => {
    await updateTenantAiSettings(tenantId, { provider: 'anthropic', apiKey: 'sk-ant-real-value-123' });
    const resolved = await getResolvedTenantAiConfig(tenantId);
    expect(resolved?.apiKey).toBe('sk-ant-real-value-123');
  });

  it('rejects an invalid provider name', async () => {
    // @ts-expect-error -- deliberately invalid, at the service layer this codebase's routes rely on for validation
    await expect(updateTenantAiSettings(tenantId, { provider: 'not-a-real-provider' })).rejects.toThrow('provider must be one of');
  });

  it('getAiAdapter prefers tenant settings over deployment-wide env vars entirely', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-deployment-wide-key';
    await updateTenantAiSettings(tenantId, { provider: 'ollama' });

    const adapter = await getAiAdapter(tenantId);
    expect(adapter).toBeInstanceOf(OllamaAdapter);
  });

  it('a tenant provider configured with no key yet returns null, never falling back to the deployment key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-deployment-wide-key';
    await updateTenantAiSettings(tenantId, { provider: 'openai' }); // no apiKey given

    const adapter = await getAiAdapter(tenantId);
    expect(adapter).toBeNull();
  });

  it('clearing tenant settings falls back to the deployment-wide config again', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-deployment-wide-key';
    await updateTenantAiSettings(tenantId, { provider: 'ollama' });
    expect(await getAiAdapter(tenantId)).toBeInstanceOf(OllamaAdapter);

    await clearTenantAiSettings(tenantId);
    expect(await getAiAdapter(tenantId)).toBeInstanceOf(AnthropicAdapter);
  });

  describe('tenant-supplied Ollama baseUrl (SSRF)', () => {
    it('cloud mode refuses to save a baseUrl pointing at a private/metadata address', async () => {
      delete process.env.SEREDINA_MODE;
      await expect(
        updateTenantAiSettings(tenantId, { provider: 'ollama', baseUrl: 'http://169.254.169.254/latest/meta-data' }),
      ).rejects.toThrow('baseUrl is not allowed');
      await expect(updateTenantAiSettings(tenantId, { provider: 'ollama', baseUrl: 'http://localhost:11434/v1' })).rejects.toThrow(
        'baseUrl is not allowed',
      );
    });

    it('self-hosted mode still allows a local Ollama', async () => {
      process.env.SEREDINA_MODE = 'self_hosted';
      const settings = await updateTenantAiSettings(tenantId, { provider: 'ollama', baseUrl: 'http://localhost:11434/v1' });
      expect(settings.baseUrl).toBe('http://localhost:11434/v1');
    });

    it('cloud mode re-checks at request time, so a private baseUrl already stored is never fetched', async () => {
      delete process.env.SEREDINA_MODE;
      // Planted directly, as if saved before this check existed.
      await withTenantTx(prisma, tenantId, (tx) =>
        tx.tenantAiSettings.create({ data: { tenantId, provider: 'ollama', baseUrl: 'http://127.0.0.1:1/v1' } }),
      );
      const adapter = await getAiAdapter(tenantId);
      const error = await adapter!.complete({ messages: [{ role: 'user', content: 'hi' }] }).catch((err: Error) => err);
      expect(error).toBeInstanceOf(Error);
      const causeMessage = String((error as Error & { cause?: Error }).cause?.message ?? (error as Error).message);
      expect(causeMessage).toContain('private/reserved');
    });
  });
});
