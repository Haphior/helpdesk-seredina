import type { CompleteInput, CompleteResult, LlmProviderAdapter, ToolCall } from './types';

/** A queued response: plain text (the common case), or a scripted tool_use turn for testing the autonomous loop. */
export type ScriptedResponse = string | { text?: string; toolCalls?: ToolCall[]; stopReason?: CompleteResult['stopReason'] };

/**
 * Deterministic double for tests and for local dev without a real API key --
 * never talks to a network. Queue responses with the constructor array (consumed
 * in order); once empty, falls back to a fixed placeholder so a test that doesn't
 * care about the exact text still gets a stable result. Every call is recorded so
 * a test can assert on the prompt a service function actually built.
 */
export class TestProviderAdapter implements LlmProviderAdapter {
  private queue: ScriptedResponse[];
  private calls: CompleteInput[] = [];

  constructor(responses: ScriptedResponse[] = []) {
    this.queue = [...responses];
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    this.calls.push(input);
    const next = this.queue.shift() ?? '[test response]';

    if (typeof next === 'string') {
      return { text: next, stopReason: 'end_turn', inputTokens: next.length, outputTokens: next.length, model: 'test-model' };
    }

    const text = next.text ?? '';
    return {
      text,
      toolCalls: next.toolCalls,
      stopReason: next.stopReason ?? (next.toolCalls ? 'tool_use' : 'end_turn'),
      inputTokens: text.length,
      outputTokens: text.length,
      model: 'test-model',
    };
  }

  getCalls(): CompleteInput[] {
    return this.calls;
  }
}
