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
running in a container, and the standard Postgres tools are what you use.

```bash
# Full backup, in Postgres's compressed custom format. Run it from the
# repository root. -T matters: without it docker allocates a terminal and
# can corrupt the binary output.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U app_migrator -Fc seredina > seredina-$(date +%Y%m%d-%H%M).dump
```

Schedule it with cron (or your provider's own backup mechanism) and copy
the file **off the machine** — a backup on the same disk as the database
doesn't survive the disk. For example, nightly at 02:30 keeping 14 days:

```text
30 2 * * * cd /opt/seredina && docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U app_migrator -Fc seredina > /var/backups/seredina/seredina-$(date +\%Y\%m\%d).dump && find /var/backups/seredina -name '*.dump' -mtime +14 -delete
```

If Postgres doesn't run in this compose file (a managed database), use
your provider's snapshots or point the same `pg_dump` at it.

### Restoring

Restore into an **empty** database, then let `migrate` finish the job:
it recreates the `app_tenant` role with the password in your `.env` and
re-applies the row-level security policies and grants, all of which live
outside a plain table dump.

```bash
# 1. Stop everything and start only Postgres, on an empty volume.
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Load the dump.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < seredina-20260101-0230.dump

# 3. Bring the rest up; migrate runs first, as on every start.
docker compose -f infra/docker-compose.yml up -d
```

`down -v` deletes the current database volume — only run it when you
really mean to replace that data. Restore into a test machine now and
then: a backup you've never restored is a guess, not a backup.

Backups also keep personal data that was later
[anonymized](/guide/contacts-and-personal-data) in the live database, until
they rotate out. Keep them only as long as you need them.

### What else you need to back up

A database dump **isn't enough on its own**. Keep a copy of your `.env`
somewhere safe and separate from the dumps — in particular:

- **`ENCRYPTION_KEY`**: every stored secret is encrypted with it
  (AES-256-GCM): email channel passwords and Gmail/Microsoft 365 OAuth
  tokens, SSO client secrets, users' MFA secrets, AI provider keys,
  webhook signing secrets and Telegram bot tokens. Restore a database
  with a different key and all of those are permanently unreadable:
  mailboxes must be reconnected, SSO reconfigured, and **every user with
  MFA must have it reset by an admin**. Guard it like the database
  password itself — and never store it in the same place as the dumps,
  or one stolen backup is enough to read every secret.
- **`JWT_SECRET`**: losing this doesn't lose data, but every active
  session becomes invalid — annoying, not catastrophic.
- **`APP_TENANT_DB_PASSWORD`** and **`POSTGRES_PASSWORD`**: not needed
  to read the dump, but restoring with the same `.env` avoids surprises.
- If you use the `proxy` profile with your own certificate, the files in
  `certs/`. Let's Encrypt certificates are reissued on their own.

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
