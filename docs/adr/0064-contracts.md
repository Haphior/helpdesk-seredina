# ADR 0064: Contracts, warranties and licenses linked to assets

## Status

Accepted, implemented. Resolves the "Contract/license/financial asset
management" backlog item.

## Context

GLPI's strongest differentiator against every other tool compared in the
roadmap was the financial side of assets. The most common "we found out too
late" failures in IT support are a warranty that lapsed a week before the
disk died, a support contract nobody renewed, or a license count exceeded.
The CMDB knew what equipment existed, but not what covered it.

## Decision

### Model

`Contract` holds:

- a name and a type (`SUPPORT`, `WARRANTY`, `LICENSE`, `LEASE`,
  `SUBSCRIPTION`, `OTHER`);
- a supplier and a reference (a contract or order number, never a license
  key);
- start and end dates, stored as `DATE` because deadlines are
  calendar-day facts, not instants;
- `renewalNoticeDays` (30 by default);
- cost (`DECIMAL(14,2)`) with a currency and a billing period (one-time,
  monthly or yearly);
- seats, for licenses;
- notes.

`ContractAsset` links many contracts to many assets. Deleting either side
removes only the link.

**Status is derived, never stored**. `active`, `expiring` (inside the
notice window) and `expired` are computed from the end date on every read,
so they can't go stale. The summary reports what's ending soon, what has
expired, and the recurring yearly cost per currency (monthly × 12 plus
yearly; one-time and expired contracts excluded). Amounts are never added
across currencies.

### Access

It uses the same tiers as the CMDB. `assets:read` sees contracts, and
`assets:manage` creates, edits and deletes them. Linked asset ids are
checked through RLS, so another tenant's asset id is simply "not found".

### Renewal reminders

A new notification type, `CONTRACT_EXPIRING`, fits the existing preference
model (in-app on by default, email opt-in).

The worker checks every 6 hours. Cross-tenant discovery uses a `SECURITY
DEFINER` function, `list_contracts_due_for_renewal_notice()`, which returns
ids only, in the same shape as `list_active_email_channels()`.

Each contract is **claimed** atomically (`renewalNotifiedAt` set from null)
before anyone is notified, so overlapping runs or replicas send nothing
twice. A Redis lock also keeps them from overlapping in the first place.
Recipients are the active users whose role has `assets:manage`.

Changing the end date or notice period clears `renewalNotifiedAt`, so a
renewed contract reminds again next time.

### Data export

Contracts and their asset links are part of the tenant export (ADR 0024).
The same pass also added the audit log and SSO settings (with the client
secret excluded by an allowlist).

## Consequences

- No purchase orders, invoices, depreciation or license-compliance counting
  (seats used vs. owned). Those would need installed-software matching
  against the agent inventory. It's a natural next step, since the agent
  already reports installed packages.
- Reminders go to asset managers as a group, not to a per-contract owner.
