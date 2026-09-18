/**
 * One entry in the tool catalog offered to the model for this call -- see
 * apps/api/src/modules/ai-tools/catalog.ts (the actual six tools) and
 * docs/adr/0034-second-llm-provider-and-autonomous-loop.md. `inputSchema` is
 * plain JSON Schema, not a zod type: this package has no zod dependency and
 * shouldn't need one just to describe a tool's shape -- the caller (the
 * autonomous loop) converts each tool's zod `argsSchema` to JSON Schema
 * once, outside this interface.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A single tool invocation the model asked for in its previous turn. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The result of actually running one ToolCall, fed back on the next turn. */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

/**
 * A conversation turn. Plain user/assistant text messages cover copilot's
 * existing single-shot calls (suggestReply/summarizeTicket); the other two
 * variants only appear once a multi-turn tool-use loop is actually running
 * (see modules/ai-tools/autonomousLoop.ts) -- an assistant turn that asked to
 * call tools, and our turn reporting what those tools returned. Each adapter
 * translates this generic shape into its own wire format (Anthropic's
 * content-block arrays, OpenAI's tool_calls/tool-role messages).
 */
export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: ToolCall[] }
  | { role: 'tool_results'; results: ToolResult[] };

export interface CompleteInput {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /** Omitted or empty: a plain completion, never a tool_use stop reason back. */
  tools?: ToolSpec[];
}

export interface CompleteResult {
  /** Empty when stopReason is 'tool_use' -- the model asked to call tools instead of answering. */
  text: string;
  /** Present only when stopReason is 'tool_use'. */
  toolCalls?: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  inputTokens: number;
  outputTokens: number;
  // Which model actually served this call -- the adapter is the source of
  // truth (it may differ from a hardcoded default via ANTHROPIC_MODEL), so
  // callers that log cost/usage (see pricing.ts) never have to re-derive it.
  model: string;
}

/**
 * Provider-agnostic seam for every AI feature (copilot, and now the
 * autonomous tool-use loop -- see docs/ROADMAP.md's Phase 3). A route/service
 * never talks to @anthropic-ai/sdk or openai directly; it only ever depends
 * on this interface, so swapping providers or substituting a test double
 * never touches call sites.
 */
export interface LlmProviderAdapter {
  complete(input: CompleteInput): Promise<CompleteResult>;
}

/**
 * Same provider-agnostic-seam pattern as LlmProviderAdapter, for embeddings
 * (RAG substrate -- see docs/adr/0032-rag-knowledge-base-search.md). `dimensions`
 * is a property, not a magic number scattered across call sites, because the
 * vector column width (`KbChunk.embedding vector(384)` in schema.prisma) is
 * pinned to whichever adapter actually wrote the data -- swapping to a
 * higher-dimension provider later means a migration, and this property is what
 * a future migration script would assert against before running.
 */
export interface EmbeddingProviderAdapter {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
