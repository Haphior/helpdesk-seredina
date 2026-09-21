# Service Catalog

Two similarly-named screens that do different things — worth
distinguishing upfront:

| Screen | Menu group | For |
|---|---|---|
| **Service Catalog** | Configuration | Items a user can *request* — build a ticket with pre-filled fields |
| **Services** | CMDB | Real business services (Email, VPN, Billing...) mapped to the assets that underpin them |

## Service Catalog (requests)

Each catalog item (name, description, optional icon) can carry a set of
[custom fields](/guide/administration#custom-fields) attached to it —
picking that item from **New ticket → From catalog** builds the form from
just those fields instead of a generic one. "Request a new laptop" and
"Report a network issue" can ask for completely different data because
they're different catalog items.

## Services (service configuration)

A real service in your operation — "Corporate Email," "VPN," "Billing" —
linked to the [CMDB assets](/guide/cmdb-and-assets) that underpin it.
When a ticket has a linked asset that's part of a service, the ticket's
panel shows which service is affected — so an agent sees the real impact
of a down asset at a glance, not just the equipment's name.
