# ADR 0052: Agent-based discovery

## Status

Accepted, implemented (phases 1–2 below). Phase 3 designed, not built.

## Context

Agentless discovery (ADR 0002) runs in `apps/worker`: the server itself sweeps
a CIDR range with TCP connects and SNMP. That only makes sense when the worker
sits on the customer's network, i.e. self-hosted. ADR 0002 already flagged that
nothing stopped a cloud tenant from trying — and in cloud mode the worker is on
*our* network, so "scan 10.0.0.0/22" probes our own infrastructure. That's an
SSRF/internal port-scan primitive, not just a feature that finds nothing.

The endpoint agent (ADR 0047) already exists: per-device credentials,
revocation, hardware/software inventory, and the server only ever *receives*.
Moving discovery onto the agent removes the server-initiated connection
entirely, and works the same in cloud and self-hosted.

## Decision

### Phase 1 — server-side scans are self-hosted only

`createDiscoveryJob` refuses (403) unless `SEREDINA_MODE=self_hosted`; unset
means cloud, the same default `registerTenant()` uses. The worker re-checks
before scanning (defense in depth, and it also fails any job queued before this
change), so `infra/docker-compose.yml` now passes `SEREDINA_MODE` to `worker`
too. `GET /discovery-jobs` returns `scanEnabled`, and the Assets page hides the
scan form when it's false.

### Phase 2a — re-enrollment dedup via a machine fingerprint

The agent sends `machineFingerprint` at enrollment: `sha256("seredina-machine:"
+ id)` of the OS's own stable id (`/etc/machine-id`, Windows `MachineGuid`,
macOS `IOPlatformUUID`). It's hashed on the device, so the raw id never leaves
it. `Device.machineFingerprint` is unique per tenant. Enrolling a machine whose
fingerprint is already known reuses its `Device` and `Asset`:

- the credential is **rotated** (the previous install's credential stops working);
- a revoked device is **reactivated** — an admin minting a fresh enrollment
  token for it is the explicit act.

Agents that send no fingerprint (older versions) keep the old behavior: a new
record per enrollment.

Known limits: cloned VMs/images that didn't regenerate their machine id share
a fingerprint and would merge; a holder of a valid enrollment token can claim
an existing device's record by presenting its fingerprint. Enrollment tokens
are admin-minted, single-use and expire in 15 minutes, so that holder is
already someone the admin chose to let enroll a machine.

### Phase 2b — passive neighbor discovery (ARP)

On every check-in the agent sends its OS ARP cache (`/proc/net/arp` on Linux,
`arp -an` on macOS, `arp -a` dynamic entries on Windows): IPv4 + MAC of devices
the machine recently talked to. No packets are sent. The agent also reports its
own primary MAC (first non-virtual interface with an IPv4 address).

Server side (`apps/api/src/modules/devices/neighbors.ts`):

- **Identity is the MAC**, which fixes ADR 0002's DHCP-churn duplicate: a known
  MAC with a new IP moves the IP on the same record.
- Unknown MAC → new `Asset` with source `AGENT_NEIGHBOR`. An IP held by a stale
  discovery record for a different MAC is released first (the lease moved on).
- **Low trust**: a device's credential is the only thing vouching for this
  data, so reports may create `AGENT_NEIGHBOR` records and edit records
  discovery owns (`AGENT_NEIGHBOR`, `AGENTLESS_SCAN`), but never edit an
  operator's `MANUAL` record (only bump `lastSeenAt`) or an enrolled agent's
  `AGENT` record (not even `lastSeenAt`, which there means "last check-in").
  A new device whose IP a `MANUAL` record holds is created without an IP.
- Capped at 512 neighbors per check-in; multicast/broadcast/all-zero MACs are
  dropped. Candidates are loaded in one query and decided in memory, so a quiet
  check-in costs two queries total.
- Enrolling a device whose MAC passive discovery already recorded **adopts**
  that record (becomes `AGENT`, keeps its history and ticket links) instead of
  creating a duplicate. Agent assets still never hold an `ipAddress` (ADR 0047).

`POST /v1/devices/checkin` now answers `200 { neighbors: { created, updated } }`
instead of `204`.

### Phase 3 — active scanning from a "collector" agent (not built)

For devices that answer to nothing an ARP cache would show (quiet printers,
switches on another VLAN): an admin marks one enrolled agent as a collector;
the server leaves a pending job that the agent picks up on its next check-in
(the polling shape ADR 0047 anticipated); `tcpProbe`/`snmpProbe` move to the
agent nearly unchanged. The agent validates the range against its own
interfaces' subnets itself, so even a compromised server can't aim agents at
arbitrary networks. Deferred until the agent ships as signed installers
running as a service — without that, few machines will have an agent at all.

## Verified

15 integration tests (`apps/api/test/agent-discovery.test.ts`, live Postgres).
Live end to end: the API in cloud mode refused a scan with 403 and
`scanEnabled: false`; the real agent on this sandbox's Linux machine enrolled,
checked in reporting its real ARP neighbor, then re-enrolled — the second
enrollment reused the same record (1 device, 2 assets: the machine itself with
its MAC, and its neighbor). macOS/Windows commands are written against their
documented syntax but unverified live, same as ADR 0047.
