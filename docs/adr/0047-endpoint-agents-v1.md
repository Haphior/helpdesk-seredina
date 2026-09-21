# ADR 0047: Endpoint agents v1 (inventory-only tier)

## Status

Accepted, implemented.

## Context

Phase 5 was the last un-started phase in `docs/ROADMAP.md`: a real background agent
installed *on* a device, going deeper than Phase 1's agentless network scan (which
only ever reads what's reachable from outside a device). The roadmap named three
capability tiers up front and was explicit that the default is the safest one. Per
the user's own decision this session, **v1 ships Tier 1 only** — inventory-only,
read-only. Remote script execution and software deployment (tiers 2/3) stay
designed-for but not built, the same "default to the safest tier" posture Phase 3's
`AutonomyPolicy` already established for a different kind of autonomous actor.

## The agent ships as a real Node.js script, not a signed installer

Researched directly before deciding, not assumed: GLPI-Agent — the tool
`docs/adr/0002-agentless-discovery.md` already named as this feature's natural
successor — is itself Perl, requires a runtime on the target machine, and gathers
inventory by shelling out to native OS utilities (`dmidecode`, `lspci`, `hdparm`),
packaged per-platform through heavy CI-specific toolchains (MSI via bundled
Strawberry Perl, `.pkg` via Xcode/productbuild, deb/rpm). That's the real, confirmed
shape of tooling in this exact space — not a shortcut this project is taking to
avoid real work. `apps/agent` follows the identical pattern in Node instead of Perl
(matching the rest of this codebase's stack): real inventory collection via `os`
plus native per-OS commands, zero npm dependencies, no build step — download the
folder and run it.

**What's deliberately NOT built, and why**: a signed installer needs a real
code-signing certificate (Windows: an OV/EV cert from a CA like DigiCert/Sectigo, or
Azure Trusted Signing, requiring business identity verification; macOS: an Apple
Developer Program membership plus notarization) and a Windows/macOS build
environment to run `signtool`/`codesign` on — neither exists in this sandbox, and
obtaining a certificate wouldn't change that (this sandbox has no Windows or macOS
to build on regardless). The concrete next step, once a cert exists: a GitHub
Actions workflow using its Windows/macOS runners to build and sign real installers.
Named here as real follow-up work, not silently deferred.

## Approach

**Storage** — two new models, mirroring `ApiKey`'s exact credential shape rather
than inventing a new one:

- **`DeviceEnrollmentToken`**: short-lived (15 min), single-use. `hashedToken` is a
  `sha256Hex` exact-match hash (`packages/shared/src/crypto.ts`, the same reasoning
  as `ApiKey.hashedKey` — a high-entropy random token, not a password). An admin
  generates one from the Devices page; shown once, like an `ApiKey`'s plaintext.
- **`Device`**: one row per enrolled endpoint. `hashedCredential` (same shape
  again), `platform` (`linux`/`darwin`/`win32`, from `os.platform()` at enrollment),
  `agentVersion`, `enrolledAt`, `revokedAt`. `assetId` is required and unique —
  every `Device` owns exactly one `Asset`, created atomically at enrollment,
  `onDelete: Cascade` from `Asset` (deleting the CMDB record removes the enrollment
  with it). *Revoking* (the compromise-response path the roadmap's own security
  section calls for — "a single compromised device can't act as every device") only
  sets `revokedAt`; the Asset and its history stay untouched, only future check-ins
  are cut off for that one device.

**`Asset` gets new nullable inventory columns, not a separate inventory table** —
the same "source-specific nullable column directly on `Asset`" shape `snmpSysDescr`
already established for agentless discovery: `cpuModel`, `memoryTotalMb`,
`diskSummary` (jsonb array of `{mount, totalGb, freeGb}`), `osVersion`
(supplementing the existing free-text `operatingSystem`), `diskEncrypted`,
`antivirusStatus`, `installedPackages` (jsonb array, informational only — not
paginated or searchable in v1). Reuses the *existing* `lastSeenAt` column for "last
check-in," the same generic meaning discovery already gives it — no new timestamp
column needed. New `AssetDiscoverySource` enum value: `AGENT`.

**Agent-enrolled assets never populate `ipAddress`.** `Asset` already has
`@@unique([tenantId, ipAddress])`; multiple agent-enrolled devices sharing a
dynamic/NAT'd IP is a real collision risk that constraint would reject. Postgres
treats `NULL` as non-colliding, so simply never setting it from the agent sidesteps
the problem entirely rather than fighting the constraint or relaxing it.

**No re-enrollment dedup.** Reinstalling the agent on the same physical machine
creates a second `Asset`+`Device` pair — a deliberate, disclosed v1 gap (a stable
cross-platform machine fingerprint is its own real problem), the same shape as the
IP-churn limitation ADR 0002 already disclosed for agentless discovery.

**Credential resolution mirrors `ApiKey`'s exact "no tenant context yet" shape,
twice over.** Two new `SECURITY DEFINER` SQL functions in
`packages/db/prisma/rls/policies.sql`, identical in shape to
`resolve_tenant_id_by_api_key_hash`: `resolve_tenant_id_by_enrollment_token_hash`
and `resolve_tenant_id_by_device_credential_hash` — each exposes only `tenant_id`,
never a credential column; the real row is re-fetched afterward through the normal
`withTenantTx`-scoped path. A new `apps/api/src/plugins/deviceAuth.ts` mirrors
`apiKeyAuth.ts` line for line for the check-in route; enrollment itself takes the
raw token in its request body, not a header, since there's no `Device` row yet to
authenticate as — the token IS the only credential that exists at that point.

**API** (`apps/api/src/modules/devices/`): `POST /devices/enrollment-tokens` and
`POST /devices/:id/revoke` (`assets:manage`, the same tier as creating a discovery
job), `GET /devices` (`assets:read`), `POST /v1/devices/enroll` (no auth decorator —
the token is the credential) and `POST /v1/devices/checkin` (`deviceAuth`).
Revocation is checked inside the check-in handler itself, not the auth plugin — it's
a per-device state question the plugin's simple hash-resolve can't answer on its
own.

**Frontend** — a new `/devices` page (CMDB nav group): a "Generate enrollment
command" button showing the one-time token as a copy-pasteable shell command, and a
device table (hostname/platform/last check-in/status) with a revoke action. The
`CopyableField`/`CopyableCodeBlock` components built for Grafana/Zabbix in
`MonitoringIntegrations.tsx` (ADR 0039/0046) were extracted to
`components/Copyable.tsx` for this second use, rather than duplicated. A light,
read-only "Agent inventory" card was added to the existing `AssetDetail.tsx`, gated
on `discoverySource === 'AGENT'`, following the exact same `snmpSysDescr &&
(...)`-conditional pattern that page already used for agentless-scan data.

**`apps/agent`** — the reference agent itself: `enroll`/`checkin`/`run` subcommands,
credentials stored to `~/.seredina-agent/credentials.json` (mode `0o600`, same
posture as an SSH private key). Inventory collection shells out to native per-OS
commands the same way GLPI-Agent does: `os` module for CPU/memory/hostname
(portable, no shelling out needed); `df -k` (Linux/macOS) or `wmic logicaldisk`
(Windows) for disk usage; `fdesetup status` (macOS, FileVault), `Get-BitLockerVolume`
via PowerShell (Windows), or an `lsblk` heuristic for a `crypt`-type device (Linux)
for disk encryption; `Get-MpComputerStatus` (Windows Defender) or built-in-XProtect
(macOS, always present) or `not_applicable` (Linux, no OS-level AV concept) for
antivirus; `dpkg-query`/`rpm -qa` (Linux), `/Applications` listing (macOS), or a
registry uninstall-key query via PowerShell (Windows) for installed packages,
capped at 500 entries. `run` loops `checkin` on an interval in the foreground only —
registering as a real background service (`systemd`, `launchd`, a Windows service)
is exactly the packaging work named as deferred above, not attempted here.

## Consequences

- Tiers 2/3 (remote execution, software deployment) can extend this schema/API
  shape cleanly when built — the `Device`/credential/revocation model doesn't need
  to change, only a new `DeviceActionPolicy`/`DeviceActionRun` pair mirroring
  `AutonomyPolicy`/`AiAgentRun` would need adding, plus the agent itself would need
  to poll for pending actions instead of only ever pushing check-ins.
- The Windows/macOS-specific shell commands (BitLocker, FileVault, Defender,
  registry-uninstall enumeration) are written against each platform's real,
  documented command syntax — not guessed — but this sandbox has no Windows or
  macOS to actually run them on. Disclosed as unverified-live, not silently
  skipped; only the Linux path was exercised for real.

## Verified

11 integration tests (`apps/api/test/devices.test.ts`, live Postgres): atomic
Asset+Device creation on enrollment, a token redeemable only once, an expired
token rejected, a made-up token rejected, check-in updates the right Asset fields
and `lastSeenAt`, a revoked device's check-in is rejected, an unknown credential is
rejected, device listing, revoking an unknown id throws, and RLS isolation between
tenants. Full `apps/api` suite 272/272 green (one pre-existing, unrelated flaky test
in `ai-usage.test.ts` reproduced on a full-suite run and passed cleanly in
isolation and on a second full-suite run — a test-parallelism artifact predating
this change, not caused by it). Every touched workspace typechecks and builds
clean, including the exact CI typecheck commands for `apps/mcp-server` and
`packages/ai-adapters` re-run locally as a precaution.

Live, against the real running dev stack and a genuinely real device (this
sandbox's own Linux machine, not a mock): generated a real enrollment token through
the actual Devices page, ran the real `apps/agent` script (`enroll` then
`checkin`) — it collected and reported this machine's actual CPU model
(`Intel(R) Core(TM) i5-10300H`), real memory (7894 MB), real disk mounts, the real
OS version string, and a real 500-entry `dpkg`-sourced package list. Confirmed in
the database directly and in the browser: the Asset shows `discoverySource: AGENT`
and the new "Agent inventory" card renders every real collected field, including a
disk-by-disk breakdown. Confirmed re-enrolling with an already-used token fails with
a clean, friendly CLI error (not a raw stack trace — fixed during this
verification). Confirmed revoking the device from the real UI makes a subsequent
real `checkin` call fail with `403 device revoked`, and the Devices page's own
status badge updates from Active to Revoked. Exercised the "Generate enrollment
command" button's real copy-to-clipboard (read back, not just visually confirmed).
Zero console errors throughout.
