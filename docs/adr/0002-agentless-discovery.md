# ADR 0002: Agentless network discovery (CMDB seed)

## Status

Accepted, implemented as a first pass.

## Context

The user asked for GLPI-style ITAM/CMDB features, prioritizing agentless dynamic
inventory first. Two scoping decisions were made explicitly with the user before
building anything:

1. **NOC/SOC stay integration targets, not native builds.** Real network monitoring
   (NOC) and security event correlation (SOC) are each their own mature product
   categories (Zabbix/Nagios, Wazuh/a SIEM) — building either from scratch would
   dwarf the rest of this project. Seredina's job is to ingest their alerts as
   tickets/incidents later (webhook ingestion, not yet built), not to replace them.
2. **This is explicitly a "best-effort seed," not a fingerprinting engine.** GLPI
   itself, after ~20 years, pairs agentless discovery with an actual agent
   (GLPI-Agent/FusionInventory) for anything more than coarse identification. A v1
   agentless sweep from a Node worker cannot compete with that — the goal here is
   "populate the CMDB with something useful to correct/enrich," not "authoritative
   hardware/software inventory."

## Decision

- **Discovery only makes sense where the worker has network access to the target
  range** — i.e., self-hosted deployments, where `apps/worker` runs on the
  customer's own network. It is architecturally meaningless in shared multi-tenant
  cloud mode (you cannot scan a customer's private LAN from a shared cloud host).
  Nothing currently blocks a cloud tenant from *trying* to scan an unreachable
  range — it will simply complete with `discoveredCount: 0` — but this should get a
  real UI warning or a mode-based restriction before cloud GA.
- **No raw sockets, no root, no `ping` binary dependency.** Host liveness
  (`apps/worker/src/discovery/tcpProbe.ts`) is a TCP-connect heuristic against a
  handful of commonly-open ports (22/80/443/445/3389/8080) with a short timeout —
  `ECONNREFUSED` counts as "alive" (something answered), only a full timeout counts
  as absent. This trades completeness (a host with every one of those ports
  firewalled looks dead) for portability: works identically bare-metal or in any
  Docker base image, no `CAP_NET_RAW`, no `iputils-ping` package.
- **SNMP (`snmpProbe.ts`, `net-snmp`, community `public`, v2c, `sysDescr`/`sysName`)
  runs in parallel with the TCP probe, not as a fallback** — it's both a second
  liveness signal and the only source of any identifying detail in this pass.
  Classification (`classify.ts`) is a substring match against `sysDescr` — genuinely
  wrong or `OTHER` guesses are expected on a meaningful fraction of results.
- **A v1 safety cap of 1024 addresses (`/22`) per scan**
  (`packages/shared/src/cidr.ts`), enforced both when the API accepts the job
  (fails fast with a 400) and structurally by `enumerateCidr` (impossible to produce
  a larger list). Prevents an accidental multi-hour scan or an accidental
  network-wide sweep from a typo'd prefix length.
- **Concurrency-limited (32 in flight), not sequential or fully parallel**
  (`apps/worker/src/lib/concurrency.ts`) — sequential would make a full /22 sweep
  take minutes even against an empty range (every dead host pays the full probe
  timeout); fully parallel would open up to 1024 sockets and SNMP sessions at once.
- **Discovered assets upsert by `(tenantId, ipAddress)`** (`schema.prisma`'s
  `Asset` model). This is a known, accepted limitation under DHCP churn — re-scanning
  after a lease changes creates a new row rather than updating the old one's IP.
  Fixing this properly needs a more stable identity (MAC address is the obvious
  candidate) and is deferred, not an oversight.
- **`TicketAsset` is a bare id-pair join**, not a richer "relationship" model
  (no relationship-type enum, no notes). Add that complexity only when a real
  workflow needs it.
- **The BullMQ queue name and job payload shape live in `packages/shared`**
  (`src/discovery.ts`), imported by both the producer (`apps/api`, which only
  enqueues — see `lib/queue.ts`) and the consumer (`apps/worker`, which processes —
  see `src/index.ts`), so the two processes can't drift on the contract between them
  the way they could if each defined its own queue name string.

## Consequences

- A firewalled-but-alive host that also happens to run no SNMP agent is invisible to
  this scanner. This is a real, known blind spot, not a bug to "fix" without adding
  a fundamentally different technique (e.g., ICMP, which reintroduces the
  root/capability requirement this ADR deliberately avoided).
- Classification quality is bounded by SNMP `sysDescr` phrasing, which varies wildly
  by vendor. Expect a non-trivial `OTHER` rate; this is the seed's honest limit, not
  a target to eliminate via more heuristics before it's clear which vendors actually
  matter to real users.
- The safety cap means a tenant with a `/16` network genuinely cannot scan it in one
  job. That's intentional for now (30+ scans of `/22` each is a UI annoyance, not a
  broken feature) — revisit only if it proves to be a real adoption blocker.
- `apps/worker` now needs real outbound network access to whatever range an operator
  scans — a self-hosted Docker Compose deployment must run the `worker` container
  with a network mode that can actually reach the target LAN (host networking or an
  equivalent), which is a deployment-time concern for operators, not something the
  application can guarantee from inside a container.
