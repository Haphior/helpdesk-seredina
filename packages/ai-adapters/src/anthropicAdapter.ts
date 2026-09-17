import Anthropic from '@anthropic-ai/sdk';
import type { CompleteInput, CompleteResult, LlmProviderAdapter } from './types';

// Default per the claude-api skill's current guidance: always claude-opus-5 unless
// told otherwise. ANTHROPIC_MODEL lets a self-hosted operator override to a
// cheaper/faster model for a high-volume, cost-sensitive deployment without a code
// change -- this is a per-ticket feature that can fire often, unlike a one-off task.
const DEFAULT_MODEL = 'claude-opus-5';

export class AnthropicAdapter implements LlmProviderAdapter {
  private client: Anthropic;
  private model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic(options?.apiKey ? { apiKey: options.apiKey } : undefined);
    this.model = options?.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 1024,
      // Disabled, not adaptive -- these are real-time UI actions (an agent clicks
      // "suggest reply" and waits), not open-ended reasoning tasks. Allowed at
      // effort <= high, which is the default we don't override here.
      thinking: { type: 'disabled' },
      system: input.system,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');

    return {
      text: textBlock?.type === 'text' ? textBlock.text : '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: this.model,
    };
  }
}
