import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// Cross-app import, deliberately -- see docs/adr/0033-ai-tool-catalog-and-autonomy.md.
// apps/api's own service layer (tickets/service.ts, macros/service.ts, etc.) is
// what every tool wraps; this app is exactly the "thin wrapper over api's service
// layer" the original architecture called for, not a second implementation.
import { TOOL_CATALOG } from '../../api/src/modules/ai-tools/catalog';
import { runTool } from '../../api/src/modules/ai-tools/executor';

function extractTicketId(args: unknown): string | undefined {
  if (args && typeof args === 'object' && 'ticketId' in args) {
    const ticketId = (args as { ticketId?: unknown }).ticketId;
    return typeof ticketId === 'string' ? ticketId : undefined;
  }
  return undefined;
}

/**
 * Builds one McpServer with the full tool catalog registered, all of it
 * closed over the given `tenantId` -- `tenantId` is never a tool input
 * argument, so a connected agent has no way to ask for another tenant's
 * data even if it tried. Shared by both transports: stdio (src/stdio.ts,
 * one process = one tenant, resolved once at startup) and the stateless
 * Streamable HTTP transport (src/http.ts, one fresh server per request,
 * tenant resolved from that request's own API key) -- see
 * docs/adr/0035-mcp-http-transport.md for why HTTP is stateless rather than
 * session-sticky.
 */
export function createMcpServer(tenantId: string): McpServer {
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

  return server;
}
