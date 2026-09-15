#!/bin/bash
set -eu

# Runs once per deploy, connected via DATABASE_URL as app_migrator (table owner).
# Never used by the running api/worker -- see prisma/rls/policies.sql for why that
# separation matters; they connect with their own DATABASE_URL, as app_tenant.

echo "[migrate] applying Prisma migrations..."
npx prisma migrate deploy

echo "[migrate] creating/updating the app_tenant role..."
# Plain shell substitution, not psql's `:'var'` -- see prisma/rls/policies.sql for why
# that form can't be used here (it doesn't reach inside a dollar-quoted DO body).
# Escape embedded single quotes so the password can't break out of the SQL literal.
ESCAPED_PASSWORD="${APP_TENANT_DB_PASSWORD//\'/\'\'}"
psql "$DATABASE_URL" <<EOF
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant LOGIN PASSWORD '$ESCAPED_PASSWORD';
  ELSE
    ALTER ROLE app_tenant PASSWORD '$ESCAPED_PASSWORD';
  END IF;
END
\$do\$;
EOF

echo "[migrate] applying RLS policies..."
psql "$DATABASE_URL" -f prisma/rls/policies.sql

echo "[migrate] seeding permission catalog..."
npm run prisma:seed

echo "[migrate] done."
