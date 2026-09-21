// Real inventory collection, shelling out to native per-OS commands the same
// way GLPI-Agent itself does (see docs/adr/0047-endpoint-agents-v1.md for the
// research that confirmed this is the real pattern for this space, not a
// shortcut). Only the Linux branch is live-verifiable in this project's own
// sandbox; macOS/Windows branches are written against each platform's real,
// documented command syntax, disclosed as unverified-live in the ADR.

import os from 'node:os';
import { execFileSync } from 'node:child_process';

const MAX_PACKAGES = 500;

function safeExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

// A well-known set of virtual/pseudo mounts to skip -- df has no flag to hide
// these portably across Linux distros, so filtering by mount point prefix is
// the same heuristic every real disk-usage tool in this space uses.
const VIRTUAL_MOUNT_PREFIXES = ['/proc', '/sys', '/dev', '/run'];

function collectDiskSummaryUnix() {
  const output = safeExec('df', ['-k']);
  if (!output) return [];
  const disks = [];
  for (const line of output.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [, blocks1k, , available1k, , mount] = parts;
    if (VIRTUAL_MOUNT_PREFIXES.some((p) => mount === p || mount.startsWith(`${p}/`))) continue;
    const totalGb = Number(blocks1k) / 1024 / 1024;
    const freeGb = Number(available1k) / 1024 / 1024;
    if (!Number.isFinite(totalGb) || totalGb <= 0) continue;
    disks.push({ mount, totalGb: Math.round(totalGb * 10) / 10, freeGb: Math.round(freeGb * 10) / 10 });
  }
  return disks;
}

function collectDiskSummaryWindows() {
  const output = safeExec('wmic', ['logicaldisk', 'get', 'size,freespace,caption']);
  if (!output) return [];
  const disks = [];
  for (const line of output.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [caption, freespace, size] = parts;
    const totalGb = Number(size) / 1024 / 1024 / 1024;
    const freeGb = Number(freespace) / 1024 / 1024 / 1024;
    if (!Number.isFinite(totalGb) || totalGb <= 0) continue;
    disks.push({ mount: caption, totalGb: Math.round(totalGb * 10) / 10, freeGb: Math.round(freeGb * 10) / 10 });
  }
  return disks;
}

// Best-effort heuristics, named as such -- see the ADR. None of these identify
// third-party products by name or handle every edge case a dedicated inventory
// tool (GLPI-Agent, osquery) would; they answer the one question v1 actually
// needs: is disk encryption/AV *present and on*, in the common case.
function collectDiskEncrypted(platform) {
  if (platform === 'darwin') {
    const output = safeExec('fdesetup', ['status']);
    return output === null ? null : /FileVault is On/i.test(output);
  }
  if (platform === 'win32') {
    const output = safeExec('powershell', ['-NoProfile', '-Command', 'Get-BitLockerVolume | Select-Object -ExpandProperty ProtectionStatus']);
    return output === null ? null : /On/i.test(output) || /\b1\b/.test(output);
  }
  // Linux: a 'crypt' TYPE entry in lsblk means at least one LUKS-mapped block device exists.
  const output = safeExec('lsblk', ['-o', 'NAME,TYPE']);
  return output === null ? null : /crypt/i.test(output);
}

function collectAntivirusStatus(platform) {
  if (platform === 'darwin') return 'xprotect_builtin';
  if (platform === 'win32') {
    const output = safeExec('powershell', ['-NoProfile', '-Command', 'Get-MpComputerStatus | Select-Object -ExpandProperty AntivirusEnabled']);
    if (output === null) return 'unknown';
    return /true/i.test(output) ? 'enabled' : 'disabled';
  }
  return 'not_applicable'; // no OS-level AV concept on Linux
}

function collectInstalledPackagesLinux() {
  let output = safeExec('dpkg-query', ['-W', '-f=${Package}\t${Version}\n']);
  if (output === null) output = safeExec('rpm', ['-qa', '--qf', '%{NAME}\t%{VERSION}\n']);
  if (output === null) return [];
  return output
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_PACKAGES)
    .map((line) => {
      const [name, version] = line.split('\t');
      return { name, version };
    });
}

function collectInstalledPackagesMac() {
  const output = safeExec('ls', ['/Applications']);
  if (output === null) return [];
  return output
    .split('\n')
    .filter((name) => name.endsWith('.app'))
    .slice(0, MAX_PACKAGES)
    .map((name) => ({ name: name.replace(/\.app$/, '') }));
}

function collectInstalledPackagesWindows() {
  const script =
    'Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | ' +
    'Where-Object { $_.DisplayName } | ' +
    'ForEach-Object { "$($_.DisplayName)`t$($_.DisplayVersion)" }';
  const output = safeExec('powershell', ['-NoProfile', '-Command', script]);
  if (output === null) return [];
  return output
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_PACKAGES)
    .map((line) => {
      const [name, version] = line.split('\t');
      return { name: name?.trim(), version: version?.trim() || undefined };
    })
    .filter((p) => p.name);
}

function collectInstalledPackages(platform) {
  if (platform === 'linux') return collectInstalledPackagesLinux();
  if (platform === 'darwin') return collectInstalledPackagesMac();
  if (platform === 'win32') return collectInstalledPackagesWindows();
  return [];
}

export function collectInventory() {
  const platform = os.platform();
  const cpus = os.cpus();

  return {
    hostname: os.hostname(),
    platform,
    cpuModel: cpus[0]?.model ?? undefined,
    memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    diskSummary: platform === 'win32' ? collectDiskSummaryWindows() : collectDiskSummaryUnix(),
    osVersion: `${os.type()} ${os.release()}`,
    diskEncrypted: collectDiskEncrypted(platform) ?? undefined,
    antivirusStatus: collectAntivirusStatus(platform),
    installedPackages: collectInstalledPackages(platform),
  };
}
