import { readFile } from 'node:fs/promises';
import { sha256Hex } from '@seredina/shared';

/**
 * What an agent needs to reach this server (docs/adr/0054-server-address-and-tls.md):
 * the public address, and -- when the server's certificate isn't signed by a
 * public CA (an internal company CA, or the proxy's own generated one) -- the
 * CA certificate to trust. The CA is public by nature (it's what every client
 * is meant to be handed); only its private key is secret, and that's never
 * readable here.
 */

const PEM_CERT = /^-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\s*/;

/**
 * The CA certificate(s) at TLS_CA_FILE, or null if unset/unreadable/not a
 * certificate. Read per call: with the proxy's generated CA the file only
 * appears after the proxy's first start, and rotating a CA shouldn't need an
 * API restart. Refuses anything that also contains a private key, so a
 * misconfigured path can't turn this public endpoint into a key leak.
 */
export async function readAgentCaCert(): Promise<string | null> {
  const path = process.env.TLS_CA_FILE;
  if (!path) return null;
  let pem: string;
  try {
    pem = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  if (/PRIVATE KEY/.test(pem) || !PEM_CERT.test(pem.trimStart())) return null;
  return pem;
}

export interface AgentSetup {
  /** Where agents should connect, from API_PUBLIC_URL; null = the console falls back to its own API address. */
  serverUrl: string | null;
  /** sha256 of the exact bytes GET /v1/devices/ca.pem returns; null = the server's certificate is publicly trusted. */
  caCertSha256: string | null;
}

export async function getAgentSetup(): Promise<AgentSetup> {
  const ca = await readAgentCaCert();
  return {
    serverUrl: process.env.API_PUBLIC_URL?.replace(/\/$/, '') || null,
    caCertSha256: ca ? sha256Hex(ca) : null,
  };
}
