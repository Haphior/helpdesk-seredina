# ADR 0031: Self-hosted setup script, Redis healthcheck, aggregate startup validation

## Status

Accepted, implemented.

## Context

Following up on the roadmap's "real setup wizard for self-hosted Docker
installs" item, which ADR 0030 deferred pending a design pass: the API
process hard-requires `JWT_SECRET`/`ENCRYPTION_KEY` as env vars before it
can even start (several modules throw at import time if they're unset), so
a *web* wizard can't generate them — the server that would serve the wizard
can't boot without them first.

Reviewing what a "wizard" actually needs to cover found the scope much
smaller than the roadmap text implied:

1. **Create the first tenant/admin** — already fully solved. `/register`
   works identically in self-hosted and cloud mode; nothing to build.
2. **Generate secrets before first boot** — the genuine chicken-and-egg
   problem, and the only piece that can't be a web UI.
3. **Verify DB/Redis connectivity with a visible pass/fail** — Postgres
   already had a real healthcheck and `depends_on: service_healthy`; Redis
   had neither, so a Redis problem was invisible until something further
   downstream failed in a more confusing way.
4. **Clear errors instead of a silent hang** — `apps/api` and `apps/worker`
   each already had per-module env-var guards (`if (!ENCRYPTION_KEY) throw`
   in `webhooks/service.ts`, `emailchannels/service.ts`, `plugins/jwt.ts`,
   etc.), but each only ever caught its own variable — a first-time
   operator missing two or three vars would fix one, restart, and discover
   the next, one at a time.

## Decisions

**`./scripts/setup.sh` replaces "copy `.env.example` and fill in nine
variables by hand" with one idempotent command.** Generates
`POSTGRES_PASSWORD`/`APP_TENANT_DB_PASSWORD` (`openssl rand -hex 24`) and
`JWT_SECRET`/`ENCRYPTION_KEY` (`openssl rand -hex 32` — not incidental for
the latter: `ENCRYPTION_KEY` must be exactly 64 hex characters, and
`rand -hex 32` produces exactly that). Refuses to touch an existing `.env`
rather than silently overwriting secrets a real deployment might already
depend on — regenerating is an explicit `rm .env && ./scripts/setup.sh`,
never automatic.

**Redis gets a real healthcheck** (`redis-cli ping`), and `api`/`worker`'s
`depends_on: redis` moved from `condition: service_started` to
`condition: service_healthy` — matching the treatment Postgres already had.
Before this, "the container process started" and "Redis is actually
accepting connections" were conflated; a slow-starting or misconfigured
Redis let dependent services begin booting against it anyway.

**One aggregate startup check per app (`apps/api/src/lib/startupCheck.ts`,
`apps/worker/src/lib/startupCheck.ts`), each the deliberate first import in
their `index.ts`.** Source order is load-bearing here, not stylistic:
Node evaluates `require()`s in the order they appear, and several existing
modules (`webhooks/service.ts`, `emailchannels/service.ts`, `plugins/jwt.ts`)
already throw their own single-variable error the moment they're imported —
being the literal first import is what guarantees the aggregate check runs
and reports everything before any of those narrower, first-one-wins errors
can fire. Each app checks only the variables it actually needs (the worker
has no `JWT_SECRET` — it never issues or verifies tokens), and
`ENCRYPTION_KEY`'s format (exactly 64 hex characters) is validated up front
rather than failing confusingly later inside an actual encrypt/decrypt call.
The existing per-module guards are deliberately left in place, not removed
— the same "more than one layer checking the same thing independently"
posture this codebase already uses for tenant isolation (RLS + the Prisma
extension), not a redundant no-op.

**README gained a "Self-hosted deployment" section** — previously the only
documented path was the local dev workflow (`npm run dev:api` etc.); the
actual `docker compose up` production path had no instructions at all.

## Verified

4 new unit tests (`apps/api/test/startup-check.test.ts`, exporting
`checkStartupEnv` for direct testing rather than relying only on its
import-time side effect): passes with every required var present and a
valid `ENCRYPTION_KEY`; lists every missing var in one thrown error, not
just the first, and doesn't mention vars that were actually fine; rejects
a too-short `ENCRYPTION_KEY` with the actual character count in the
message; rejects a correctly-sized but non-hex `ENCRYPTION_KEY`. Full
suite 159/159 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

`scripts/setup.sh` verified directly (not through vitest, since it's a
shell script): run in an isolated scratch directory against a copy of the
real `.env.example`, confirmed the four generated secrets are the exact
required lengths (48/48/64/64 hex characters), confirmed re-running it
against an already-populated `.env` leaves the file byte-for-byte
unchanged (idempotency), confirmed `docker-compose.yml` still parses as
valid YAML after the healthcheck edit.

The aggregate startup check was verified against the *real* application
entry points, not a mock: invoking `apps/api/src/index.ts` and
`apps/worker/src/index.ts` directly via `tsx` with no env vars set
produced the complete, correctly-formatted list of everything missing for
each app; with a deliberately-too-short `ENCRYPTION_KEY` set, the error
correctly reported "got 8 characters"; with every var valid, the process
proceeded all the way to Fastify attempting to bind its port (confirmed by
the failure mode changing to `EADDRINUSE` against the already-running dev
server, meaning every startup check had already passed).

**Known gap, not silently skipped**: this sandboxed environment has no
working `docker compose` (neither the plugin nor the standalone binary),
which this session has hit before (see the environment's own quirks memory)
— so the actual multi-container orchestration path (`migrate` → `api`/
`worker` waiting on Redis's new healthcheck → `web`) could not be run
end-to-end as a real `docker compose up`. What's verified instead is every
piece that composes it: the script's output, the compose file's validity,
and the exact application code that would run inside each container,
invoked directly. A `docker build` of `Dockerfile.api` was attempted
separately as an extra check; it produced no meaningful output before
hitting a timeout in this sandbox (most likely slow/uncached layer
pulls, not a fault in the Dockerfile) and was abandoned rather than
retried — inconclusive, not a pass, and not claimed as one.

## Consequences / known v1 limitations

- Not end-to-end verified through actual `docker compose up` in this
  session, for the environment reason above — a real self-hosted operator
  running this for the first time is still the true validation this
  hasn't had yet.
- `scripts/setup.sh` is Bash-only (`set -euo pipefail`, `openssl`) — fine
  for the Linux/Mac self-hosting audience this targets, not tested on
  Windows outside WSL.
- Still no automated way to *rotate* `ENCRYPTION_KEY` on a live deployment
  with existing encrypted data (email channel passwords, webhook secrets)
  — regenerating via the script is only safe before any real secrets have
  been stored.
