import { prisma, withTenantTx } from '@seredina/db';
import { assertPublicUrl, decryptSecret, encryptSecret } from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

export const AI_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

function isValidProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

/**
 * In cloud mode a tenant's own Ollama base URL is attacker-controlled from the
 * server's point of view -- without this, any tenant could point it at our
 * internal network or the cloud metadata endpoint and have the API fetch it.
 * A self-hosted operator's Ollama legitimately lives on localhost/the LAN, and
 * there's only the one tenant, so the guard only applies in cloud mode.
 */
export function tenantBaseUrlNeedsSsrfGuard(): boolean {
  return process.env.SEREDINA_MODE !== 'self_hosted';
}

/** Never includes the key itself, decrypted or not -- see modules/ai/routes.ts. */
export interface TenantAiSettingsView {
  provider: AiProvider | null;
  hasApiKey: boolean;
  model: string | null;
  baseUrl: string | null;
}

const EMPTY_VIEW: TenantAiSettingsView = { provider: null, hasApiKey: false, model: null, baseUrl: null };

function toView(row: { provider: string | null; apiKeyEncrypted: string | null; model: string | null; baseUrl: string | null } | null): TenantAiSettingsView {
  if (!row) return EMPTY_VIEW;
  return { provider: row.provider as AiProvider | null, hasApiKey: Boolean(row.apiKeyEncrypted), model: row.model, baseUrl: row.baseUrl };
}

export async function getTenantAiSettings(tenantId: string): Promise<TenantAiSettingsView> {
  return withTenantTx(prisma, tenantId, async (tx) => toView(await tx.tenantAiSettings.findUnique({ where: { tenantId } })));
}

export interface UpdateTenantAiSettingsInput {
  provider?: AiProvider | null;
  /** Plaintext -- only present when the admin is setting/replacing the key. Omitted means "leave whatever's stored alone." */
  apiKey?: string;
  model?: string | null;
  baseUrl?: string | null;
}

export async function updateTenantAiSettings(tenantId: string, input: UpdateTenantAiSettingsInput): Promise<TenantAiSettingsView> {
  if (input.provider != null && !isValidProvider(input.provider)) {
    throw new Error(`provider must be one of ${AI_PROVIDERS.join(', ')}`);
  }
  // Fail fast with a readable error at save time; adapter.ts re-checks on every
  // request anyway, since DNS can change after the URL was saved.
  if (input.baseUrl && tenantBaseUrlNeedsSsrfGuard()) {
    try {
      await assertPublicUrl(input.baseUrl);
    } catch (err) {
      throw new Error(`baseUrl is not allowed: ${(err as Error).message}`);
    }
  }
  const apiKeyEncrypted = input.apiKey !== undefined ? encryptSecret(input.apiKey, ENCRYPTION_KEY!) : undefined;

  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.tenantAiSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: input.provider ?? null,
        apiKeyEncrypted: apiKeyEncrypted ?? null,
        model: input.model ?? null,
        baseUrl: input.baseUrl ?? null,
      },
      update: { provider: input.provider, apiKeyEncrypted, model: input.model, baseUrl: input.baseUrl },
    }),
  );
  return toView(row);
}

/** Explicit, separate action (not "PATCH with apiKey: null") -- same "clearing is a deliberate act" posture as webhook secret rotation. */
export async function clearTenantAiSettings(tenantId: string): Promise<void> {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.tenantAiSettings.findUnique({ where: { tenantId } });
    if (existing) await tx.tenantAiSettings.delete({ where: { tenantId } });
  });
}

export interface ResolvedTenantAiConfig {
  provider: AiProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Internal to modules/ai/adapter.ts's getAiAdapter -- the decrypted key never
 * leaves this function. Returns null when the tenant hasn't configured a
 * provider at all (not "configured but incomplete" -- a provider set with no
 * key still returns a config object, so getAiAdapter can tell "use env-wide
 * fallback" apart from "configured for a cloud provider but missing its key,
 * don't silently fall back to the deployment's own key instead").
 */
export async function getResolvedTenantAiConfig(tenantId: string): Promise<ResolvedTenantAiConfig | null> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const row = await tx.tenantAiSettings.findUnique({ where: { tenantId } });
    if (!row?.provider) return null;
    return {
      provider: row.provider as AiProvider,
      apiKey: row.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted, ENCRYPTION_KEY!) : undefined,
      model: row.model ?? undefined,
      baseUrl: row.baseUrl ?? undefined,
    };
  });
}
