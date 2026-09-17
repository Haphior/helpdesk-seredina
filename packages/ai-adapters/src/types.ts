export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteInput {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  // Which model actually served this call -- the adapter is the source of
  // truth (it may differ from a hardcoded default via ANTHROPIC_MODEL), so
  // callers that log cost/usage (see pricing.ts) never have to re-derive it.
  model: string;
}

/**
 * Provider-agnostic seam for every AI feature (copilot now, autonomous mode and
 * the MCP server's shared tool catalog later -- see docs/ROADMAP.md's Phase 3).
 * A route/service never talks to @anthropic-ai/sdk directly; it only ever depends
 * on this interface, so swapping providers or substituting a test double never
 * touches call sites.
 */
export interface LlmProviderAdapter {
  complete(input: CompleteInput): Promise<CompleteResult>;
}
