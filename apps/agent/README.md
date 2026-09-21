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

To keep it checking in automatically (foreground only — see the ADR for why there's
no background-service installer yet):

```sh
node src/index.mjs run --interval 3600
```

Requires Node.js 18+ on the target machine.
