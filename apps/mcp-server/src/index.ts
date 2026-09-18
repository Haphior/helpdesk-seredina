#!/usr/bin/env node
import { runStdio } from './stdio';
import { runHttp } from './http';

/**
 * MCP_TRANSPORT picks which transport this process runs -- 'stdio' (default,
 * unchanged from before HTTP support existed: one process per client,
 * spawned on demand, e.g. by Claude Desktop) or 'http' (a long-running
 * Streamable HTTP service, stateless -- see http.ts and
 * docs/adr/0035-mcp-http-transport.md).
 */
async function main() {
  const transport = process.env.MCP_TRANSPORT ?? 'stdio';
  if (transport === 'http') {
    return runHttp();
  }
  if (transport === 'stdio') {
    return runStdio();
  }
  throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${transport}"`);
}

main().catch((err) => {
  console.error('Seredina MCP server failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
