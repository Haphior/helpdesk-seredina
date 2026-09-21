# CMDB & Assets

Seredina's CMDB has three related but distinct screens: **Assets** (the
inventory itself), **Devices** (the endpoint agent that feeds it
automatically), and **Equipment Catalog** (the hardware models you can
assign to an asset).

## Assets

Each row is a server, workstation, network device, printer, or mobile
device — with type, status, IP, hostname, serial number,
manufacturer/model, and operating system. An asset can be linked to the
tickets that affect it (from the ticket itself, see
[Tickets](/guide/tickets#the-properties-panel)), building up a history of
what problems each piece of equipment had.

### How an asset reaches the inventory

- **Manual** — created by hand from **New Asset**.
- **Agentless discovery** — scanning a network range (TCP + SNMP) from
  the Assets screen itself. Finds whatever responds on the network,
  without installing anything on the target machine — with that
  technique's logical limitations: if a machine has its firewall closed
  or SNMP disabled, it won't show up.
- **Agent** — see [Devices](#devices) below. Brings more detail than
  agentless discovery because it runs *inside* the machine, not from the
  outside.

## Devices

**Devices** is where you generate the install command for Seredina's
lightweight agent (`apps/agent`, an unsigned Node.js script with no
dependencies). Running on a real machine, it reports hardware/software
inventory, OS version, whether the disk is encrypted, and antivirus
status.

::: warning Inventory-only, by permanent design
The agent **never executes anything remotely** — no scripts, no software
deployment. This isn't a temporary limitation of this version: remote
execution and signed installers require ongoing costs (a code-signing
certificate, an Apple Developer membership) that this unfunded
open-source project has no way to responsibly absorb. See the
[MVP tour](https://github.com/Haphior/helpdesk-seredina) for the full
reasoning.
:::

Every enrolled device also shows up under **Assets**, tagged "AGENT" as
its discovery source — it's the same inventory, just with an extra column
showing where the data came from. Revoking a device from this screen cuts
off its future check-ins without deleting its already-saved history.

## Equipment Catalog

A catalog of manufacturers and hardware models (for example, "Dell" →
"Latitude 5540") — separate from individual assets. Assigning a catalog
model to an asset pre-fills its default type, but the asset keeps its own
independently editable type field: the catalog suggests, it doesn't
force.
