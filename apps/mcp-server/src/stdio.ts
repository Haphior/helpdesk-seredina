import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';
import { resolveTenantIdFromApiKey } from './auth';

/**
 * stdio transport = one process = one client = one tenant, so the ApiKey is
 * resolved to a tenantId exactly ONCE at startup and closed over by every tool
 * handler for the life of the process -- there is no per-request tenant
 * switch to isolate, so no session-keyed state is needed here (unlike the
 * Streamable HTTP transport in http.ts, which resolves a tenant fresh per
 * request instead).
 */
export async function runStdio(): Promise<void> {
  const apiKey = process.env.SEREDINA_API_KEY;
  if (!apiKey) {
    throw new Error('SEREDINA_API_KEY env var is required (create one from Settings > API Keys)');
  }
  const tenantId = await resolveTenantIdFromApiKey(apiKey);
  if (!tenantId) {
    throw new Error('SEREDINA_API_KEY does not match any known API key');
  }

  const server = createMcpServer(tenantId);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Seredina MCP server running on stdio, tenant ${tenantId}`);
}
