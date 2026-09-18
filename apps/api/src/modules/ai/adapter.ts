import { AnthropicAdapter, OllamaAdapter, OpenAIAdapter, type LlmProviderAdapter } from '@seredina/ai-adapters';
import { getResolvedTenantAiConfig, type AiProvider } from './settings';

const VALID_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;

function isValidProvider(value: string): value is AiProvider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

function buildAdapter(provider: AiProvider, apiKey: string | undefined, model: string | undefined, baseUrl: string | undefined): LlmProviderAdapter | null {
  switch (provider) {
    case 'anthropic':
      return apiKey ? new AnthropicAdapter({ apiKey, model }) : null;
    case 'openai':
      return apiKey ? new OpenAIAdapter({ apiKey, model }) : null;
    case 'ollama':
      // No API key check -- Ollama's own "required but unused" placeholder
      // is baked into OllamaAdapter itself, not conditioned on config here.
      return new OllamaAdapter({ baseURL: baseUrl, model });
  }
}

function deploymentWideAdapter(): LlmProviderAdapter | null {
  const configured = process.env.AI_PROVIDER;
  if (configured && !isValidProvider(configured)) {
    console.error(`AI_PROVIDER="${configured}" is not one of ${VALID_PROVIDERS.join(', ')} -- AI features are disabled.`);
    return null;
  }
  const provider: AiProvider | null =
    configured && isValidProvider(configured) ? configured : process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (!provider) return null;

  return buildAdapter(
    provider,
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : provider === 'openai' ? process.env.OPENAI_API_KEY : undefined,
    provider === 'anthropic' ? process.env.ANTHROPIC_MODEL : provider === 'openai' ? process.env.OPENAI_MODEL : process.env.OLLAMA_MODEL,
    undefined,
  );
}

/**
 * `AI_PROVIDER` picks the deployment-wide default LlmProviderAdapter --
 * 'anthropic' (cloud), 'openai' (cloud), or 'ollama' (local, no API key, no
 * per-call cost -- see docs/adr/0034-second-llm-provider-and-autonomous-loop.md
 * for why a local option was added alongside a second cloud one). Unset falls
 * back to the pre-multi-provider behavior (Anthropic if ANTHROPIC_API_KEY is
 * set), so an existing self-hosted deployment's .env keeps working unchanged.
 *
 * Phase 4's bring-your-own-key (docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md):
 * a tenant with its OWN `TenantAiSettings` row takes priority over the
 * deployment-wide config entirely -- checked first, and if that tenant
 * configured a provider, the deployment-wide env vars are never consulted at
 * all, even as a fallback for a missing key. That's deliberate: a tenant that
 * picked "openai" but hasn't pasted a key yet should see "AI not configured"
 * (null), never silently fall back to using the *deployment's* Anthropic key
 * for a request they explicitly routed elsewhere.
 *
 * Null, not a throw, whenever the resolved provider's own requirement isn't
 * met (no key, or an unrecognized AI_PROVIDER value) -- AI is an optional
 * feature (like error tracking, like email channels), never something that
 * should turn every AI route into a 500 over one misconfigured setting.
 */
export async function getAiAdapter(tenantId: string): Promise<LlmProviderAdapter | null> {
  const tenantConfig = await getResolvedTenantAiConfig(tenantId);
  if (tenantConfig) {
    return buildAdapter(tenantConfig.provider, tenantConfig.apiKey, tenantConfig.model, tenantConfig.baseUrl);
  }
  return deploymentWideAdapter();
}
