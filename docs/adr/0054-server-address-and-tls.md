# ADR 0054: Server address and TLS

## Status

Accepted, implemented.

## Context

A self-hosted install answered on `http://localhost:8080` (console) and
`http://localhost:4000` (API), and choosing anything else meant three things
by hand:

- **The console's API address was baked in at build time** (`VITE_API_URL`,
  default `http://localhost:4000`), so moving the server to a real domain or IP
  meant rebuilding the web image with the right value.
- **HTTPS was entirely the operator's job**: "put a reverse proxy in front"
  was the whole of the documentation.
- **Agents could only trust publicly issued certificates.** Node's default
  roots reject a company CA or a self-signed certificate, and the agent had no
  way to be told otherwise, so an internal-network install had to run agents
  over plain HTTP, sending the agent credential in the clear.

## Decision

### One address: the API lives at `/api` on the console's origin

The web container's nginx now proxies `/api/*` to the API (prefix stripped),
and the console defaults to `${location.origin}/api` when `VITE_API_URL` is
empty — the new default. The same build works at any domain or IP, over
HTTP or HTTPS, and console → API calls are same-origin. `VITE_API_URL` still
works for an API on a different origin. Details:

- nginx resolves `api` through Docker's DNS every 10 s (`resolver` + a variable
  `proxy_pass`). A fixed `proxy_pass http://api:4000` resolves once at startup
  and breaks for good when the api container restarts with a new IP.
- `GET /api/events` (ADR 0053) is proxied unbuffered with a 1 h read timeout.
- The embeddable widget used to derive the API from its script's *origin*; it
  now takes everything before `/widget.js`, so `…/api/widget.js` works.
- `vite dev` proxies `/api` the same way, so dev matches production.

### HTTPS: an optional Caddy service with four modes

`infra/docker-compose.yml` gains a `proxy` service (Caddy, `proxy` compose
profile) on ports 80/443, forwarding everything to `web`. `infra/caddy/Caddyfile`
picks one snippet from `infra/caddy/tls/` by `TLS_MODE`:

- `acme` — Let's Encrypt, automatic issuance and renewal. Needs a domain.
- `custom` — the operator's `certs/cert.pem` + `certs/key.pem`.
- `internal` — Caddy's own private CA, for an IP or internal-only name.
- `off` — plain HTTP on port 80, for labs.

Caddy over nginx+certbot because automatic ACME with renewal, an internal CA,
and HTTP→HTTPS redirects are each one line, with no cron job. It only
terminates TLS; routing stays in the web container's nginx.

`scripts/configure-address.sh` (also offered at the end of `setup.sh`) asks
for the address and the mode, or takes flags for unattended installs, and
writes `.env`: `SEREDINA_SITE`, `TLS_MODE`, `WEB_ORIGIN`, `API_PUBLIC_URL`,
`COMPOSE_PROFILES`, and so on. For `custom` it checks that the key matches the
certificate, that the certificate covers the address (a warning), and that it
was signed by the CA given. It can be re-run at any time.

### Once the proxy is in front, it is the only way in

With the proxy enabled, the script binds the web (8080) and API (4000) ports
to `127.0.0.1`. Otherwise anyone on the network could skip HTTPS through them.
They could also send their own `X-Forwarded-For` through nginx and dodge
per-IP rate limits. `--keep-direct-ports` keeps them open for a migration.

The API now sits behind proxies, so it needs `trustProxy`: without it every
request appears to come from nginx, and login's per-IP limit becomes one
bucket shared by everyone. `TRUST_PROXY` (compose: `loopback,uniquelocal`) is
parsed in `apps/api/src/index.ts`. Caddy replaces any client-supplied
`X-Forwarded-For` with the real peer address, so a spoofed header dies at the
edge. That was checked against the real chain (below).

Found along the way: Postgres and Redis were published on every interface,
and Redis has no password. Both now bind to `127.0.0.1` (`DB_BIND`); `worker`
uses host networking and still reaches them at localhost.

### Agents: server address, and the CA carried in the enrollment command

- `GET /devices/agent-setup` (`assets:manage`) returns the address agents
  should use (`API_PUBLIC_URL`) and, when `TLS_CA_FILE` is set, that CA
  certificate and its SHA-256 (shown for comparison). It refuses any file that
  contains `PRIVATE KEY`, so a mistyped path can't leak a key into the console.
- The Devices page shows an editable "Server address for agents" field,
  prefilled from `API_PUBLIC_URL`, for a device that reaches the server some
  other way, such as a VPN. The enrollment command follows the field and, when
  a CA is configured, adds `--ca-pem <the CA, base64>`.
- The agent passes that CA as Node's `ca` option, which *replaces* the default
  roots: it trusts only that CA for this server, and hostname verification
  stays on. `--ca <file>` does the same with a local file. It never turns
  certificate verification off.

**Why the CA travels in the command, not as a download.** The first version
had the agent download the CA from an unauthenticated `GET /v1/devices/ca.pem`
with verification off, then trust it only if its SHA-256 matched a fingerprint
in the command. That was sound, since nothing was trusted before the hash
check. But it meant code that disables certificate validation, which CodeQL
rightly flags (`js/disabling-certificate-validation`), plus a public endpoint
that needn't exist. Carrying the CA itself in the command removes both. The
command gets longer (~1 KB for Caddy's EC root, a few KB for an RSA company
CA), which is fine for a copy-button field and well within shell limits. It
comes from the authenticated console, so it's as trustworthy as the enrollment
token next to it.

`TLS_CA_FILE` per mode: `internal` → Caddy's root in the `caddy_data` volume
(mounted read-only into `api`); `custom` → `certs/ca.pem`, taken from `--ca` or
from the certificate itself when it's self-signed; `acme` → unset, since the
certificate is publicly trusted.

## Consequences

- Agents enrolled at `http://<ip>:4000` stop reaching the server once the
  direct ports are bound to localhost. They need the new command;
  re-enrolling keeps their record (machine fingerprint, ADR 0052).
- Integrations (Grafana/Zabbix webhooks, the widget) point at
  `https://<address>/api/...` from now on. The console already shows the new
  URLs.
- `caddy_data` holds issued certificates and the internal CA, and must be
  backed up. A new internal CA means re-enrolling agents and re-trusting it in
  browsers.

## Verified

- **Caddyfile**: all four modes adapt cleanly with Caddy 2.10.2 (`caddy
  adapt`), with the expected listeners and issuers.
- **nginx config**: passes `nginx -t`.
- **Compose file**: renders with `docker compose config`.
- **`configure-address.sh`**, exercised on:
  - each mode;
  - an IP address with `acme` (refused);
  - a pasted URL (normalized);
  - a key that doesn't match its certificate (refused);
  - a CA that didn't sign the certificate (refused);
  - a certificate that doesn't cover the address (warned);
  - a self-signed certificate (pinned as its own CA);
  - an email containing `&`;
  - an existing `mcp` profile, kept.
- **Integration tests** (`apps/api/test/agent-setup.test.ts`):
  - the CA and its fingerprint are returned for the command, and the old
    unauthenticated download no longer exists;
  - a file containing a key is never handed out;
  - missing or junk files are ignored;
  - `assets:manage` is required.

Live, with the real Caddyfile (`internal` mode) → the real nginx server block
→ the API, then Chromium and the real agent:

- The console, built with no API URL, loaded over HTTPS and its live stream
  connected through both proxies.
- The Devices page prefilled `https://…/api`, and the CA in its command was
  exactly Caddy's generated root CA; editing the address updated the command.
- The agent enrolled and checked in with the pinned CA. It was refused
  ("unable to get local issuer certificate") without the CA, and again with a
  different CA pinned. Garbage in `--ca-pem` was rejected. Nothing was saved
  after any failure.
- A spoofed `X-Forwarded-For` sent through Caddy reached the API as the real
  client address. Sent to the nginx port directly, it was taken as given,
  which is why those ports bind to localhost.
