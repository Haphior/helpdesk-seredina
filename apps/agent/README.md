# @seredina/agent

Reference endpoint agent for Seredina's Phase 5 v1 (inventory-only). See
[`docs/adr/0047-endpoint-agents-v1.md`](../../docs/adr/0047-endpoint-agents-v1.md)
for the full design and its known limitations.

Plain Node.js, zero dependencies, no build step — download this folder and run it
directly. It never executes remote commands or deploys software; it only reports
hardware/software inventory back to Seredina.

## Usage

Generate a one-time enrollment command from Seredina's Devices page (Administration
→ Devices), then on the target machine:

```sh
node src/index.mjs enroll --url https://your-seredina-instance.example.com --token <token>
node src/index.mjs checkin
```

The enrollment command from the Devices page already carries the right
server address. If the server's certificate isn't publicly trusted (a company
CA, a self-signed certificate, or the proxy's generated `internal` CA), it
also carries `--ca-sha256 <fingerprint>`: the agent downloads the server's CA,
refuses it unless it matches that fingerprint, and from then on trusts only
that CA for this server (stored next to the credential as `ca.pem`). With a CA
file already on hand, `--ca <file.pem>` does the same without the download.
See [`docs/adr/0054-server-address-and-tls.md`](../../docs/adr/0054-server-address-and-tls.md).

To keep it checking in automatically (foreground only — see the ADR for why there's
no background-service installer yet):

```sh
node src/index.mjs run --interval 3600
```

Requires Node.js 18+ on the target machine.

## What it reports

Besides hardware/software inventory, since
[`docs/adr/0052-agent-based-discovery.md`](../../docs/adr/0052-agent-based-discovery.md):

- **A machine fingerprint** at enrollment — a SHA-256 of the OS's own machine
  id (`/etc/machine-id`, Windows `MachineGuid`, macOS `IOPlatformUUID`), hashed
  locally so the raw id never leaves the machine. Reinstalling the agent on the
  same machine reuses its existing record instead of creating a duplicate.
- **Its own primary MAC address**, and on every check-in **its ARP cache** — the
  devices it has recently talked to on the local network. That's passive
  discovery: printers, routers and other machines show up in the CMDB without
  the agent (or the server) scanning anything.
