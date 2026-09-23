#!/usr/bin/env bash
# Builds every image in infra/docker-compose.yml, brings the stack up with
# throwaway secrets, and checks it actually works end to end: migrations ran,
# the console is served, the API answers through the console's /api proxy,
# a tenant can register and read its tickets (so RLS and the app_tenant role
# are wired up), and the worker stays up.
#
# Used by CI (.github/workflows/ci.yml) and runnable locally. Uses its own
# compose project and ports so it never touches a real deployment on the
# same machine, and tears everything down (volumes included) when done.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT=seredina-smoke
WEB_PORT=${SMOKE_WEB_PORT:-18080}
ENV_FILE=$(mktemp)

cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=smoke-migrator-password
POSTGRES_PORT=${SMOKE_POSTGRES_PORT:-55432}
REDIS_PORT=${SMOKE_REDIS_PORT:-56379}
APP_TENANT_DB_PASSWORD=smoke-tenant-password
JWT_SECRET=smoke-jwt-secret-not-for-production-000000000000000000
ENCRYPTION_KEY=$(openssl rand -hex 32)
SEREDINA_MODE=self_hosted
API_PORT=${SMOKE_API_PORT:-14000}
WEB_PORT=${WEB_PORT}
WEB_ORIGIN=http://localhost:${WEB_PORT}
EOF

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f infra/docker-compose.yml "$@"
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "::group::compose logs"
    compose ps -a || true
    compose logs --no-color --tail=200 || true
    echo "::endgroup::"
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "SMOKE TEST FAILED: $*" >&2
  exit 1
}

echo "==> Building images"
compose build

echo "==> Starting the stack"
compose up -d

BASE="http://localhost:${WEB_PORT}"

echo "==> Waiting for the API behind the console's /api proxy"
for _ in $(seq 1 90); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$BASE/api/health" | grep -q '"ok"' || fail "API /health never answered through $BASE/api"

migrate_exit=$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -a -q migrate)")
[ "$migrate_exit" = "0" ] || fail "migrate exited with $migrate_exit"

echo "==> Console is served"
curl -fsS "$BASE/" | grep -qi '<div id="root"' || fail "console index.html not served"

echo "==> Register a tenant and read its tickets"
register=$(curl -fsS -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -d '{"tenantSlug":"smoke","tenantName":"Smoke Co","adminEmail":"admin@smoke.test","adminName":"Admin","password":"smoke-password-123"}') \
  || fail "tenant registration failed"
token=$(printf '%s' "$register" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$token" ] || fail "registration returned no token: $register"

curl -fsS "$BASE/api/tickets" -H "authorization: Bearer $token" | grep -q '"tickets"' \
  || fail "authenticated GET /tickets failed"

echo "==> Worker stays up"
sleep 10
worker_state=$(docker inspect -f '{{.State.Status}}' "$(compose ps -a -q worker)")
[ "$worker_state" = "running" ] || fail "worker is $worker_state"

echo "Smoke test passed."
