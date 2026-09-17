export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/**
 * Anthropic first-party API rates, current as of 2026-06-24. This is for
 * tenant-facing cost *transparency* (docs/adr/0023-ai-cost-transparency.md),
 * not an invoice -- re-verify against Anthropic's own pricing page before
 * trusting this for a real billing decision. Deliberately a plain object,
 * not a DB table: pricing changes are a code change (a new model needs a new
 * adapter default anyway), not tenant-configurable data.
 */
const PRICING: Record<string, ModelPricing> = {
  'claude-fable-5': { inputPerMillionUsd: 10, outputPerMillionUsd: 50 },
  'claude-mythos-5': { inputPerMillionUsd: 10, outputPerMillionUsd: 50 },
  'claude-opus-5': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  'claude-opus-4-8': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  'claude-opus-4-7': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  'claude-opus-4-6': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  'claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'claude-sonnet-4-6': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
};

/** Returns null for a model this table doesn't recognize -- an unpriced call is logged with a null cost, never a guessed number. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING[model];
  if (!pricing) return null;
  return (inputTokens / 1_000_000) * pricing.inputPerMillionUsd + (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
}
