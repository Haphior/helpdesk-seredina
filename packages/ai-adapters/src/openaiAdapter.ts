import OpenAI from 'openai';
import type { CompleteInput, CompleteResult, LlmProviderAdapter, ToolCall } from './types';

// gpt-4.1 as a sane default; OPENAI_MODEL overrides it the same way
// ANTHROPIC_MODEL overrides AnthropicAdapter's default -- a self-hosted
// operator picks whichever model fits their cost/quality tradeoff without a
// code change.
const DEFAULT_MODEL = 'gpt-4.1';

/**
 * Second LlmProviderAdapter implementation (see AnthropicAdapter) -- exists
 * to prove the adapter interface is actually provider-agnostic, not just
 * documented as such. Uses the Chat Completions API (not the newer Responses
 * API): Ollama's OpenAI-compatibility layer (see OllamaAdapter) only
 * implements Chat Completions, and sharing one request/response shape
 * between the two adapters is worth more than being on OpenAI's newest
 * surface for its own sake.
 */
export class OpenAIAdapter implements LlmProviderAdapter {
  private client: OpenAI;
  private model: string;

  constructor(options?: { apiKey?: string; model?: string; fetch?: typeof fetch }) {
    // `fetch` is the SDK's own documented seam for tests to inject a fake
    // HTTP layer -- see openaiAdapter.test.ts, which uses it to verify the
    // real request/response shape without a network call or a real API key.
    this.client = new OpenAI({ apiKey: options?.apiKey ?? process.env.OPENAI_API_KEY, fetch: options?.fetch });
    this.model = options?.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
      ...toOpenAiMessages(input.messages),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      // max_completion_tokens, not the deprecated max_tokens -- see this
      // adapter's ADR for why a fresh implementation uses the current field.
      max_completion_tokens: input.maxTokens ?? 1024,
      tools: input.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] | undefined = choice?.message.tool_calls
      ?.filter((tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
      .map((tc) => ({ id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) }));

    return {
      text: choice?.message.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model: response.model,
    };
  }
}

/**
 * Shared with OllamaAdapter (identical wire format) -- translates the
 * provider-agnostic LlmMessage union into OpenAI's shape. Unlike Anthropic,
 * OpenAI has no block-based content: a tool-call turn becomes an assistant
 * message with `tool_calls`, and each tool result becomes its OWN message
 * with `role: 'tool'` (not one grouped block, the way Anthropic's tool_result
 * blocks can share a single user message).
 */
export function toOpenAiMessages(messages: CompleteInput['messages']): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.flatMap((m): OpenAI.Chat.ChatCompletionMessageParam[] => {
    if (m.role === 'tool_results') {
      return m.results.map((r) => ({ role: 'tool' as const, tool_call_id: r.toolCallId, content: r.content }));
    }
    if ('toolCalls' in m) {
      return [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        },
      ];
    }
    return [{ role: m.role, content: m.content }];
  });
}
