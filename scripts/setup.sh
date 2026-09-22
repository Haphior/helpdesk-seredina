#!/bin/bash
set -euo pipefail

# First-run setup for a self-hosted install. Solves the one piece of onboarding
# that genuinely can't be a web wizard: apps/api hard-requires JWT_SECRET and
# ENCRYPTION_KEY as env vars before it can even start (several modules throw at
# import time if they're unset -- see e.g. modules/webhooks/service.ts), so the
# server that would serve a setup wizard can't boot without them existing first.
# Everything else onboarding needs (create the first tenant/admin, verify DB/Redis
# connectivity) already works once the stack is actually running -- see
# docs/adr/0031-self-hosted-startup-checks.md.

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "[setup] .env already exists -- leaving it alone."
  echo "[setup] Delete it first if you want to regenerate secrets from scratch."
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[setup] openssl not found -- install it, or copy .env.example to .env" >&2
  echo "[setup] and fill in POSTGRES_PASSWORD / APP_TENANT_DB_PASSWORD / JWT_SECRET /" >&2
  echo "[setup] ENCRYPTION_KEY by hand (ENCRYPTION_KEY must be exactly 64 hex chars)." >&2
  exit 1
fi

cp .env.example .env

# APP_TENANT_DB_PASSWORD and POSTGRES_PASSWORD: plain random hex, no shell-
# special characters -- migrate-entrypoint.sh already escapes single quotes
# defensively, but there's no reason to generate a password that needs it.
# JWT_SECRET: any long random string works; hex is as good as any.
# ENCRYPTION_KEY: MUST be exactly 64 hex chars (32 bytes) -- `rand -hex 32`
# produces exactly that, not a coincidence.
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_TENANT_DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# A delimiter openssl's own hex output can never contain, so plain `sed -i`
# substitution can't be broken by the generated value itself.
sed -i.bak \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
  -e "s|^APP_TENANT_DB_PASSWORD=.*|APP_TENANT_DB_PASSWORD=${APP_TENANT_DB_PASSWORD}|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
  -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" \
  .env
rm -f .env.bak

echo "[setup] Generated .env with fresh POSTGRES_PASSWORD, APP_TENANT_DB_PASSWORD,"
echo "[setup] JWT_SECRET, and ENCRYPTION_KEY."
echo "[setup]"
echo "[setup] Back up .env's ENCRYPTION_KEY once real email channels exist --"
echo "[setup] losing it makes every stored IMAP/SMTP password undecryptable."
echo "[setup]"
echo "[setup] Optional: set ANTHROPIC_API_KEY in .env for the AI copilot."
echo "[setup]"

# Address and HTTPS (docs/adr/0054-server-address-and-tls.md). Only asked
# interactively: an automated install passes flags to configure-address.sh
# itself, and skipping it keeps the old localhost-only behavior.
if [ -t 0 ]; then
  read -r -p "[setup] Set the server's address and HTTPS now? [Y/n]: " answer
  if [[ ! "${answer:-y}" =~ ^[Nn] ]]; then
    echo
    scripts/configure-address.sh
    exit 0
  fi
fi
echo "[setup] To serve Seredina at your own address with HTTPS, run scripts/configure-address.sh."
echo "[setup]"
echo "[setup] Next: docker compose -f infra/docker-compose.yml up"
