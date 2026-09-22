#!/usr/bin/env node
// Reference endpoint agent -- Phase 5 v1, inventory-only (docs/adr/0047-
// endpoint-agents-v1.md). Plain Node.js, zero dependencies, no build step:
// download and run, the same way you'd run any other single-file agent.
//
// Usage:
//   node src/index.mjs enroll --url <api-url> --token <enrollment-token>
//                             [--ca-pem <base64> | --ca <ca-file.pem>]
//   node src/index.mjs checkin
//   node src/index.mjs run [--interval <seconds>]

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { collectInventory } from './inventory.mjs';
import { collectNeighbors, machineFingerprint, primaryMacAddress } from './network.mjs';

const CONFIG_DIR = path.join(os.homedir(), '.seredina-agent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'credentials.json');
// The pinned CA for a server whose certificate isn't publicly trusted
// (docs/adr/0054-server-address-and-tls.md). When present, it is the ONLY CA
// this agent trusts for that server -- Node's `ca` option replaces the
// default roots rather than adding to them.
const CA_PATH = path.join(CONFIG_DIR, 'ca.pem');
const DEFAULT_INTERVAL_SECONDS = 60 * 60; // 1 hour -- inventory doesn't change minute to minute, unlike e.g. email polling

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// `ca`: trust only this CA (Node's `ca` replaces the default roots). The
// agent never turns certificate verification off.
function request(urlString, { method = 'GET', headers = {}, body, ca } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const tls = url.protocol === 'https:' && ca ? { ca } : {};
    const req = lib.request(
      url,
      {
        ...tls,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          if (status >= 200 && status < 300) resolve(parsed);
          else reject(new Error(`HTTP ${status}: ${JSON.stringify(parsed)}`));
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value}" is not a valid server address -- expected e.g. https://helpdesk.example.com/api`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('the server address must start with https:// (or http://)');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    console.warn('Warning: this server address uses http://, so the agent credential and inventory travel unencrypted. Use https:// outside a test setup.');
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * Resolves which CA to pin, if any, for a server whose certificate isn't
 * publicly trusted: the CA itself, base64-encoded in the enrollment command
 * the admin copied from the console (--ca-pem), or a local file (--ca). It
 * arrives with the command rather than being fetched from the server, so the
 * agent never has to talk to a server it can't yet verify.
 */
function resolveCa(args) {
  let pem;
  if (args['ca-pem']) {
    pem = Buffer.from(args['ca-pem'], 'base64').toString('utf8');
  } else if (args.ca) {
    pem = fs.readFileSync(args.ca, 'utf8');
  } else {
    return undefined;
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----') || pem.includes('PRIVATE KEY')) {
    throw new Error('the CA given is not a PEM certificate -- copy the enrollment command from the console again.');
  }
  return pem;
}

async function cmdEnroll(args) {
  const { token } = args;
  if (!args.url || !token) {
    console.error('Usage: node src/index.mjs enroll --url <api-url> --token <enrollment-token> [--ca-pem <base64> | --ca <ca-file.pem>]');
    process.exitCode = 1;
    return;
  }
  const url = normalizeServerUrl(args.url);
  const ca = resolveCa(args);

  const result = await request(`${url}/v1/devices/enroll`, {
    ca,
    method: 'POST',
    body: {
      enrollmentToken: token,
      hostname: os.hostname(),
      platform: os.platform(),
      // Lets the server reuse this machine's record on a reinstall, or adopt
      // one passive discovery already created -- see network.mjs.
      machineFingerprint: machineFingerprint(),
      macAddress: primaryMacAddress(),
    },
  });

  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (ca) fs.writeFileSync(CA_PATH, ca, { mode: 0o600 });
  else fs.rmSync(CA_PATH, { force: true }); // re-enrolling against a publicly trusted server drops an old pin
  // mode 0o600: the credential is a real, permanent, per-device bearer secret
  // (docs/adr/0047-endpoint-agents-v1.md) -- readable only by the user running
  // the agent, same posture as an SSH private key.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ url, credential: result.credential }, null, 2), { mode: 0o600 });
  console.log(`${result.reenrolled ? 'Re-enrolled (existing record reused)' : 'Enrolled'}. Credential saved to ${CONFIG_PATH}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('Not enrolled yet -- run "node src/index.mjs enroll --url <api-url> --token <enrollment-token>" first.');
    process.exitCode = 1;
    return null;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (fs.existsSync(CA_PATH)) config.ca = fs.readFileSync(CA_PATH, 'utf8');
  return config;
}

async function cmdCheckin() {
  const config = loadConfig();
  if (!config) return;

  const inventory = collectInventory();
  const neighbors = collectNeighbors();
  const result = await request(`${config.url}/v1/devices/checkin`, {
    method: 'POST',
    ca: config.ca,
    headers: { Authorization: `Bearer ${config.credential}` },
    body: { ...inventory, macAddress: primaryMacAddress(), neighbors },
  });
  const found = result?.neighbors ? `, ${neighbors.length} neighbors (${result.neighbors.created} new)` : '';
  console.log(`Checked in: ${inventory.hostname} (${inventory.platform})${found}`);
}

async function cmdRun(args) {
  const intervalMs = (args.interval ? Number(args.interval) : DEFAULT_INTERVAL_SECONDS) * 1000;
  console.log(`Running in the foreground -- checking in every ${intervalMs / 1000}s. Ctrl+C to stop.`);
  // Foreground only, by design: registering as a real background service/daemon
  // (systemd unit, launchd plist, Windows service) is exactly the packaging
  // work named as deferred in the ADR, not attempted here.
  for (;;) {
    try {
      await cmdCheckin();
    } catch (err) {
      console.error('Check-in failed:', err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

try {
  switch (command) {
    case 'enroll':
      await cmdEnroll(args);
      break;
    case 'checkin':
      await cmdCheckin();
      break;
    case 'run':
      await cmdRun(args);
      break;
    default:
      console.log('Usage: node src/index.mjs <enroll|checkin|run> [options]');
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
