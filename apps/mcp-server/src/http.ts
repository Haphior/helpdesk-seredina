import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { resolveTenantIdFromApiKey } from './auth';

const DEFAULT_PORT = 3100;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function extractApiKey(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/**
 * Streamable HTTP transport, deliberately stateless (`sessionIdGenerator:
 * undefined`, the SDK's own documented mode for exactly this) -- a fresh
 * McpServer + transport per request, tenant resolved fresh from that
 * request's own `Authorization: Bearer <ApiKey>` header. See
 * docs/adr/0035-mcp-http-transport.md for why: this codebase already avoids
 * server-side sticky session state everywhere else (RLS + the Prisma
 * extension re-check tenant scope on every query, never cache it; the
 * PRD's own Phase 4 goal is verified stateless multi-replica api/worker),
 * and the SDK's stateful mode keeps session/connection state in memory on
 * whichever single process happened to handle the client's first request --
 * the wrong shape for a service meant to run behind a load balancer with
 * multiple replicas. The cost is re-resolving the tenant on every request
 * (one extra RLS-backed lookup) instead of once per session; negligible
 * next to what it avoids.
 */
export async function runHttp(): Promise<void> {
  const port = Number(process.env.MCP_HTTP_PORT ?? DEFAULT_PORT);

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.url !== '/mcp') {
      return sendJson(res, 404, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Not found. The MCP endpoint is POST /mcp.' },
        id: null,
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This transport is stateless: only POST /mcp is supported.' },
        id: null,
      });
    }

    const apiKey = extractApiKey(req);
    const tenantId = apiKey ? await resolveTenantIdFromApiKey(apiKey) : null;
    if (!tenantId) {
      return sendJson(res, 401, {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized. Send a valid Seredina API key as "Authorization: Bearer <key>".' },
        id: null,
      });
    }

    try {
      const server = createMcpServer(tenantId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      console.error('Error handling MCP request:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.error(`Seredina MCP server running on Streamable HTTP (stateless), listening on port ${port}`);
}
