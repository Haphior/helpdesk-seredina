import { AnthropicAdapter, type LlmProviderAdapter } from '@seredina/ai-adapters';

/**
 * Null, not a throw, when ANTHROPIC_API_KEY is unset -- AI is an optional feature
 * (like error tracking, like email channels), not something the API should refuse
 * to boot without. Routes turn a null adapter into a 503, not a 500.
 */
export function getAiAdapter(): LlmProviderAdapter | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new AnthropicAdapter();
}
