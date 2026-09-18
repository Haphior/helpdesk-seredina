import Anthropic from '@anthropic-ai/sdk';
import type { CompleteInput, CompleteResult, LlmProviderAdapter, ToolCall } from './types';

// Default per the claude-api skill's current guidance: always claude-opus-5 unless
// told otherwise. ANTHROPIC_MODEL lets a self-hosted operator override to a
// cheaper/faster model for a high-volume, cost-sensitive deployment without a code
// change -- this is a per-ticket feature that can fire often, unlike a one-off task.
const DEFAULT_MODEL = 'claude-opus-5';

/** Anthropic's native stop_reason has more values than this adapter's generic one distinguishes -- only tool_use matters to a caller, everything else means "done, read `text`." */
function toStopReason(reason: string | null): CompleteResult['stopReason'] {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end_turn';
}

export class AnthropicAdapter implements LlmProviderAdapter {
  private client: Anthropic;
  private model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic(options?.apiKey ? { apiKey: options.apiKey } : undefined);
    this.model = options?.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    // Anthropic's content model is block-based even for plain text turns, so
    // every LlmMessage variant maps onto it uniformly: a tool-call turn becomes
    // tool_use blocks, and our tool_results turn becomes a *user* message of
    // tool_result blocks (Anthropic has no separate "tool" role, unlike OpenAI --
    // see OpenAIAdapter).
    const messages = input.messages.map((m) => {
      if (m.role === 'tool_results') {
        return {
          role: 'user' as const,
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError,
          })),
        };
      }
      if ('toolCalls' in m) {
        return {
          role: 'assistant' as const,
          content: m.toolCalls.map((tc) => ({ type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input as object })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxTokens ?? 1024,
      // Disabled, not adaptive -- these are real-time UI actions (an agent clicks
      // "suggest reply" and waits), not open-ended reasoning tasks. Allowed at
      // effort <= high, which is the default we don't override here.
      thinking: { type: 'disabled' },
      system: input.system,
      messages,
      tools: input.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
      })),
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    const toolCalls: ToolCall[] = response.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    return {
      text: textBlock?.type === 'text' ? textBlock.text : '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: toStopReason(response.stop_reason),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: this.model,
    };
  }
}
