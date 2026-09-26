# ADR 0068: The endpoint agent moves to Go, in its own repository

## Status

Accepted, implemented. Supersedes the "`apps/agent`" part of
`docs/adr/0047-endpoint-agents-v1.md`. The rest of that ADR still applies:
the server side, enrollment, credentials, and the scope (inventory only).

## Context

`apps/agent` was a Node.js script. It had three problems in production:

- **Node.js on every device.** Nobody wants to install and patch Node.js
  on every company laptop just to run an inventory agent.
- **No service.** The agent had no way to install itself as a service, so
  keeping `run` alive was left to the operator.
- **Broken on real devices.** Using it on real machines found these bugs:
  - On macOS it read disks with `df -k`, whose inode columns put the wrong
    field in the mount point.
  - On Windows it recognised neighbors by the English word "dynamic" in
    `arp -a`, which a Spanish Windows doesn't print.
  - It relied on `wmic`, which recent Windows 11 removes.
  - Its credential under ProgramData was readable by every user of the
    machine.

## Decision

The agent is rewritten in Go and lives in its own repository,
[Haphior/seredina-agent](https://github.com/Haphior/seredina-agent),
under AGPL-3.0 like Seredina. It is released separately from Seredina.

- **One static binary per platform.** Windows, macOS and Linux, each on
  amd64 and arm64, built with `CGO_ENABLED=0`. There is no runtime to
  install.
- **Runs as a service.** `enroll --install` or `install` registers the
  agent as a Windows service, a launchd daemon or a systemd unit, and
  copies the binary to Program Files or `/usr/local/bin`. It uses
  `kardianos/service`.
- **Install scripts.** Each release publishes `install.sh` and
  `install.ps1`, and the Devices page shows the matching command for each
  OS. The scripts download the archive, verify it against `SHA256SUMS`,
  and then run `enroll --install`. `AGENT_DOWNLOAD_URL` points the
  commands at an internal mirror, for networks without GitHub access.
- **Compatible with the Node agent.** The API contract,
  `credentials.json`, its per-user location and the machine fingerprint
  are unchanged. A test pins the fingerprint to the Node agent's value.
  An already-enrolled machine keeps its CMDB record.
- **TLS.** Same as before: a CA from the enrollment command becomes the
  only trusted root, and verification is never disabled.
- **Credential location.** As administrator/root it is kept in:
  - ProgramData, restricted to SYSTEM and Administrators.
  - `/Library/Application Support`.
  - `/etc/seredina-agent`, mode 0700.
- **Unsigned for now.** Releases are not code-signed. The build script and
  the release workflow mark where signing goes. The install scripts
  aren't affected: `curl` doesn't set macOS's quarantine flag, and the
  PowerShell script runs `Unblock-File`.

`apps/agent` is removed from this repository.

## Consequences

- The agent's release cycle is separate from Seredina's. The Devices page
  links to `releases/latest`, so a new agent release reaches new
  enrollments without a Seredina release.
- The agent must keep accepting the device API as Seredina serves it.
  Breaking changes to `/v1/devices/*` need a version check on the agent
  side from now on.
- Signing (an Authenticode certificate, an Apple Developer ID and
  notarization) remains an open cost, as ADR 0047 describes.

## Verified

- The agent's unit tests cover the Linux and macOS `df` parsers, the three
  ARP formats (including a Spanish Windows), the Windows inventory report,
  and fingerprint parity with the Node agent.
- An httptest TLS server tests enroll and check-in with a pinned CA, and
  that the agent refuses any other certificate.
- CI runs the tests on Ubuntu, macOS and Windows runners, so each OS's
  real collectors run.
- A throwaway test ran the released Linux binary against this repository's
  real API and Postgres: enroll, check-in (CPU, memory, OS, disks, 500
  packages, MAC, a neighbor), and a re-enroll that reused the same
  record.
