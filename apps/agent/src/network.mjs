// Machine identity and passive network discovery (docs/adr/0055-agent-based-
// discovery.md). Nothing here sends a single packet: the fingerprint comes
// from the OS's own machine id, and neighbors come from the ARP cache the OS
// already keeps. Same per-OS shell-out approach as inventory.mjs; only the
// Linux branch is live-verifiable in this project's own sandbox.

import os from 'node:os';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MAX_NEIGHBORS = 512; // matches the API's own cap
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function safeExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

function readFirst(paths) {
  for (const p of paths) {
    try {
      const value = fs.readFileSync(p, 'utf8').trim();
      if (value) return value;
    } catch {
      // try the next one
    }
  }
  return null;
}

function rawMachineId(platform) {
  if (platform === 'linux') return readFirst(['/etc/machine-id', '/var/lib/dbus/machine-id']);
  if (platform === 'darwin') {
    const output = safeExec('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return output?.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? null;
  }
  if (platform === 'win32') {
    const output = safeExec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
    return output?.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1] ?? null;
  }
  return null;
}

/**
 * A stable per-machine id, so reinstalling the agent reuses the same CMDB
 * record. Hashed here so the raw OS id never leaves the machine. Undefined
 * if the OS gives us nothing -- the server then falls back to "new record".
 */
export function machineFingerprint(platform = os.platform()) {
  const raw = rawMachineId(platform);
  if (!raw) return undefined;
  return createHash('sha256').update(`seredina-machine:${raw.toLowerCase()}`).digest('hex');
}

// Interfaces that exist on the machine but aren't how it appears on the LAN
// (containers, VMs, VPNs), so other agents would never see these MACs.
const VIRTUAL_INTERFACE = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|wg|zt|tailscale|awdl|llw|bridge)/i;

/** The MAC this machine most likely shows on its LAN: the first physical-looking interface with an IPv4 address. */
export function primaryMacAddress() {
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    const ipv4 = addresses?.find((a) => a.family === 'IPv4' && !a.internal);
    if (ipv4 && ipv4.mac && ipv4.mac !== '00:00:00:00:00:00') return ipv4.mac;
  }
  return undefined;
}

// macOS's `arp` drops leading zeros ("0:1b:2c:..."), so pad every octet.
function padMac(mac) {
  const octets = mac.split(/[:-]/);
  return octets.length === 6 ? octets.map((o) => o.padStart(2, '0')).join(':') : null;
}

function neighborsLinux() {
  // /proc/net/arp needs no root and no extra binary:
  // IP address  HW type  Flags  HW address  Mask  Device
  const text = readFirst(['/proc/net/arp']);
  if (!text) return [];
  return text
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 6 && cols[2] !== '0x0') // 0x0 = incomplete entry
    .map(([ip, , , mac]) => ({ ip, mac }));
}

function neighborsMac() {
  // "? (192.168.1.1) at a0:b1:c2:d3:e4:f5 on en0 ifscope [ethernet]"
  const output = safeExec('arp', ['-an']);
  if (!output) return [];
  const neighbors = [];
  for (const line of output.split('\n')) {
    const match = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\) at ([0-9a-f:]+) /i);
    if (!match) continue; // includes "(incomplete)" entries
    const mac = padMac(match[2]);
    if (mac) neighbors.push({ ip: match[1], mac });
  }
  return neighbors;
}

function neighborsWindows() {
  // "  192.168.1.1           a0-b1-c2-d3-e4-f5     dynamic"
  // Static entries are broadcast/multicast bookkeeping, not real hosts.
  const output = safeExec('arp', ['-a']);
  if (!output) return [];
  const neighbors = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f-]{17})\s+dynamic/i);
    if (match) neighbors.push({ ip: match[1], mac: match[2] });
  }
  return neighbors;
}

/** The OS's ARP cache: devices this machine has recently talked to on its LAN. */
export function collectNeighbors(platform = os.platform()) {
  const raw = platform === 'linux' ? neighborsLinux() : platform === 'darwin' ? neighborsMac() : platform === 'win32' ? neighborsWindows() : [];
  return raw.filter((n) => IPV4.test(n.ip) && /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(n.mac)).slice(0, MAX_NEIGHBORS);
}
