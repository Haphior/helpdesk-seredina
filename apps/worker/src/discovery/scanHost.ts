import { reverse } from 'node:dns/promises';
import { isHostAlive } from './tcpProbe';
import { probeSnmp } from './snmpProbe';
import { classifyAsset } from './classify';
import type { AssetType } from '@seredina/db';

export interface HostScanResult {
  ipAddress: string;
  name: string;
  hostname: string | null;
  assetType: AssetType;
  snmpSysDescr: string | null;
}

async function reverseDns(ip: string): Promise<string | null> {
  try {
    const names = await reverse(ip);
    return names[0] ?? null;
  } catch {
    return null; // no PTR record -- expected for most hosts, not an error worth logging
  }
}

/** Null means "nothing answered at this address" -- not every IP in a range is in use. */
export async function scanHost(ip: string): Promise<HostScanResult | null> {
  const [tcpAlive, snmpFacts, hostname] = await Promise.all([isHostAlive(ip), probeSnmp(ip), reverseDns(ip)]);

  if (!tcpAlive && !snmpFacts) return null;

  const name = hostname ?? snmpFacts?.sysName ?? ip;

  return {
    ipAddress: ip,
    name,
    hostname,
    assetType: classifyAsset(snmpFacts?.sysDescr),
    snmpSysDescr: snmpFacts?.sysDescr ?? null,
  };
}
