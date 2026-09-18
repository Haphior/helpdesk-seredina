import OpenAI from 'openai';
import type { CompleteInput, CompleteResult, LlmProviderAdapter, ToolCall } from './types';
import { toOpenAiMessages } from './openaiAdapter';

const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/**
 * Local LLM completions via Ollama's OpenAI-compatibility layer (confirmed
 * via Ollama's own docs, not guessed: base URL is the host's `/v1`, the
 * `api_key` is "required, but unused" by Ollama itself -- the placeholder
 * below satisfies the SDK's own type, nothing more). Reuses the `openai`
 * package as an HTTP client rather than hand-rolling fetch calls, since
 * Ollama deliberately mirrors the OpenAI Chat Completions request/response
 * shape -- this is the third LlmProviderAdapter (see AnthropicAdapter,
 * OpenAIAdapter), giving a self-hosted operator a genuinely free, private,
 * no-API-key option alongside the two cloud providers. Tool-calling support
 * depends on the specific local model's own training -- not every model
 * pulled via `ollama pull` was trained for it, verified separately per model,
 * not assumed here.
 *
 * Ollama's own docs describe this compatibility layer as "initial
 * experimental support" -- `usage` (token counts) may be absent depending on
 * the Ollama version/model, handled the same defensive way OpenAIAdapter
 * does (default to 0, never throw on a missing field).
 */
export class OllamaAdapter implements LlmProviderAdapter {
  private client: OpenAI;
  private model: string;

  constructor(options?: { baseURL?: string; model?: string; fetch?: typeof fetch }) {
    this.client = new OpenAI({
      apiKey: 'ollama',
      baseURL: options?.baseURL ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL,
      fetch: options?.fetch,
    });
    this.model = options?.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
      ...toOpenAiMessages(input.messages),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
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
      // "ollama:" prefix lets estimateCostUsd (pricing.ts) recognize this ran
      // locally and report a real $0 rather than an unpriced null -- without
      // needing a pricing-table entry for whatever arbitrary model name an
      // operator happened to `ollama pull`.
      model: `ollama:${response.model}`,
    };
  }
}
