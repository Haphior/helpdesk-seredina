#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveTenantIdByApiKeyHash } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';
// Cross-app import, deliberately -- see docs/adr/0033-ai-tool-catalog-and-autonomy.md.
// apps/api's own service layer (tickets/service.ts, macros/service.ts, etc.) is
// what every tool wraps; this app is exactly the "thin wrapper over api's service
// layer" the original architecture called for, not a second implementation.
import { TOOL_CATALOG } from '../../api/src/modules/ai-tools/catalog';
import { runTool } from '../../api/src/modules/ai-tools/executor';

/**
 * stdio transport = one process = one client = one tenant, so the ApiKey is
 * resolved to a tenantId exactly ONCE at startup and closed over by every tool
 * handler below -- there is no per-request tenant switch to isolate, so no
 * AsyncLocalStorage is needed here (unlike the deferred HTTP/SSE transport,
 * where one server process really would serve multiple concurrent tenant
 * sessions and AsyncLocalStorage is what keeps them from bleeding into each
 * other). `tenantId` is never a tool input argument -- a connected agent has
 * no way to ask for another tenant's data even if it tried.
 */
async function resolveTenantId(): Promise<string> {
  const apiKey = process.env.SEREDINA_API_KEY;
  if (!apiKey) {
    throw new Error('SEREDINA_API_KEY env var is required (create one from Settings > API Keys)');
  }
  const tenantId = await resolveTenantIdByApiKeyHash(sha256Hex(apiKey));
  if (!tenantId) {
    throw new Error('SEREDINA_API_KEY does not match any known API key');
  }
  return tenantId;
}

function extractTicketId(args: unknown): string | undefined {
  if (args && typeof args === 'object' && 'ticketId' in args) {
    const ticketId = (args as { ticketId?: unknown }).ticketId;
    return typeof ticketId === 'string' ? ticketId : undefined;
  }
  return undefined;
}

async function main() {
  const tenantId = await resolveTenantId();

  const server = new McpServer({ name: 'seredina', version: '0.1.0' });

  for (const tool of TOOL_CATALOG) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.argsSchema.shape },
      async (args: unknown) => {
        try {
          const result = await runTool(tenantId, tool.name, args, { source: 'mcp', ticketId: extractTicketId(args) });
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Seredina MCP server running on stdio, ${TOOL_CATALOG.length} tools registered, tenant ${tenantId}`);
}

main().catch((err) => {
  console.error('Seredina MCP server failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
