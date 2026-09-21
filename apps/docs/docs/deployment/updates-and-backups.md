# Updates and Backups

## Updating your instance

There's no auto-update mechanism — it's a `git pull` and bringing the
containers back up:

```bash
git pull origin main
docker compose -f infra/docker-compose.yml up -d --build
```

The `migrate` service runs again automatically as part of startup and
applies any new schema migration before `api` starts taking traffic.
There's no separate manual "run the migrations" step.

::: tip Before updating in production
Check the commit log since your last update
(`git log <your-current-commit>..origin/main --oneline`) and, if anything
worries you specifically, check the matching ADR in `docs/adr/` — every
non-trivial architecture decision has an entry there explaining the why,
not just the what.
:::

## Backups

Seredina doesn't ship automated backups — it's a standard Postgres
running in a container, and the standard Postgres tools are what you use:

```bash
# Full backup
docker compose -f infra/docker-compose.yml exec postgres \
  pg_dump -U app_migrator seredina > backup-$(date +%Y%m%d).sql

# Restore
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U app_migrator seredina < backup-20260101.sql
```

For real production use, run this via cron or your infrastructure
provider's own backup mechanism — Seredina doesn't assume anything about
where Postgres runs or how you schedule backups.

### What else you need to back up

A `pg_dump` of the database **isn't enough on its own**:

- **`ENCRYPTION_KEY`**: without this exact key, every stored email
  channel password (encrypted with AES-256-GCM) becomes permanently
  undecryptable, even with a perfectly restored database. Guard it with
  the same seriousness as the database password itself.
- **`JWT_SECRET`**: losing this doesn't lose data, but every active
  session becomes invalid — annoying, not catastrophic.

### Per-tenant data export

Separate from an infrastructure backup, every tenant has its own complete
export in an open format: **Settings → Data Export** in the console (or
`GET /export` directly) returns a single JSON file with all ~35 tables
that belong to that tenant. It's the honest answer to "data portability":
migrating *away* from Seredina is one click, not a deliberately painful
process like some tools whose business model depends on making it hard to
leave. Secrets (password hashes, API key hashes, encrypted credentials)
are always excluded from the export — they never leave the database.

This is per-tenant data portability, not a replacement for a real
infrastructure backup — use it for migration or audits, not as your only
copy.
