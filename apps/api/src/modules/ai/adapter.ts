import { AnthropicAdapter, OllamaAdapter, OpenAIAdapter, type LlmProviderAdapter } from '@seredina/ai-adapters';

const VALID_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
type AiProvider = (typeof VALID_PROVIDERS)[number];

function isValidProvider(value: string): value is AiProvider {
  return (VALID_PROVIDERS as readonly string[]).includes(value);
}

/**
 * `AI_PROVIDER` picks which LlmProviderAdapter backs the copilot -- 'anthropic'
 * (cloud), 'openai' (cloud), or 'ollama' (local, no API key, no per-call cost --
 * see docs/adr/0034-second-llm-provider-and-autonomous-loop.md for why a local
 * option was added alongside a second cloud one, not instead of it: giving a
 * self-hosted operator a genuinely free/private choice was the point, not just
 * proving the adapter interface works with a second vendor). Unset falls back
 * to the pre-multi-provider behavior (Anthropic if ANTHROPIC_API_KEY is set),
 * so an existing self-hosted deployment's .env keeps working unchanged.
 *
 * Null, not a throw, whenever the resolved provider's own requirement isn't
 * met (no key, or an unrecognized AI_PROVIDER value) -- AI is an optional
 * feature (like error tracking, like email channels), never something that
 * should turn every AI route into a 500 over a single misconfigured env var.
 */
export function getAiAdapter(): LlmProviderAdapter | null {
  const configured = process.env.AI_PROVIDER;
  if (configured && !isValidProvider(configured)) {
    console.error(`AI_PROVIDER="${configured}" is not one of ${VALID_PROVIDERS.join(', ')} -- AI features are disabled.`);
    return null;
  }
  const provider: AiProvider | null =
    configured && isValidProvider(configured) ? configured : process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;

  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ? new AnthropicAdapter() : null;
    case 'openai':
      return process.env.OPENAI_API_KEY ? new OpenAIAdapter() : null;
    case 'ollama':
      // No API key check -- Ollama's own "required but unused" placeholder
      // is baked into OllamaAdapter itself, not conditioned on env config here.
      return new OllamaAdapter();
    case null:
      return null;
  }
}
