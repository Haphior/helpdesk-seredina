#!/usr/bin/env node
// Reference endpoint agent -- Phase 5 v1, inventory-only (docs/adr/0047-
// endpoint-agents-v1.md). Plain Node.js, zero dependencies, no build step:
// download and run, the same way you'd run any other single-file agent.
//
// Usage:
//   node src/index.mjs enroll --url <api-url> --token <enrollment-token>
//   node src/index.mjs checkin
//   node src/index.mjs run [--interval <seconds>]

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { collectInventory } from './inventory.mjs';

const CONFIG_DIR = path.join(os.homedir(), '.seredina-agent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'credentials.json');
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

function request(urlString, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = lib.request(
      url,
      {
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

async function cmdEnroll(args) {
  const { url, token } = args;
  if (!url || !token) {
    console.error('Usage: node src/index.mjs enroll --url <api-url> --token <enrollment-token>');
    process.exitCode = 1;
    return;
  }

  const result = await request(`${url}/v1/devices/enroll`, {
    method: 'POST',
    body: { enrollmentToken: token, hostname: os.hostname(), platform: os.platform() },
  });

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // mode 0o600: the credential is a real, permanent, per-device bearer secret
  // (docs/adr/0047-endpoint-agents-v1.md) -- readable only by the user running
  // the agent, same posture as an SSH private key.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ url, credential: result.credential }, null, 2), { mode: 0o600 });
  console.log(`Enrolled. Credential saved to ${CONFIG_PATH}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('Not enrolled yet -- run "node src/index.mjs enroll --url <api-url> --token <enrollment-token>" first.');
    process.exitCode = 1;
    return null;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

async function cmdCheckin() {
  const config = loadConfig();
  if (!config) return;

  const inventory = collectInventory();
  await request(`${config.url}/v1/devices/checkin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.credential}` },
    body: inventory,
  });
  console.log(`Checked in: ${inventory.hostname} (${inventory.platform})`);
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
