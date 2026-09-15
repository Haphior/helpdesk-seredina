import type { AssetType } from '@seredina/db';

/**
 * A heuristic seed, not a fingerprinting engine -- substring-matches the SNMP
 * sysDescr banner (which vendors format however they like) against common markers.
 * Wrong or "OTHER" guesses are expected and fine to correct by hand later; the goal
 * is a useful starting classification for most of a scan, not a guarantee for all of it.
 */
export function classifyAsset(sysDescr: string | undefined): AssetType {
  if (!sysDescr) return 'OTHER';
  const d = sysDescr.toLowerCase();

  if (d.includes('windows')) return d.includes('server') ? 'SERVER' : 'WORKSTATION';
  if (d.includes('linux') || d.includes('ubuntu') || d.includes('debian') || d.includes('centos')) return 'SERVER';
  if (d.includes('printer') || d.includes('laserjet') || d.includes('officejet')) return 'PRINTER';
  if (
    d.includes('cisco') ||
    d.includes('mikrotik') ||
    d.includes('router') ||
    d.includes('switch') ||
    d.includes('ubiquiti') ||
    d.includes('unifi')
  ) {
    return 'NETWORK_DEVICE';
  }

  return 'OTHER';
}
