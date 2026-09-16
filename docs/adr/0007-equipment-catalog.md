# ADR 0007: Equipment catalog — reference tables, not a rework of Asset

## Status

Accepted, implemented.

## Context

Roadmap addition, requested directly: make manual inventory entry easier by
letting an admin pick "Dell / OptiPlex 7090" from a list instead of re-typing
manufacturer/model/type every time. `Asset` already had free-text `manufacturer`
and `model` columns, populated by agentless discovery from whatever a device's
SNMP `sysDescr` says — text that can't be constrained to a curated catalog. The
design question was how a curated catalog coexists with that.

## Decisions

**Two new reference tables (`Manufacturer`, `AssetModel`), decoupled from
`Asset`, not a rework of its existing columns.** `Asset.manufacturer`/`Asset.model`
(free text) are untouched — discovery keeps writing to them exactly as before.
A new `Asset.modelId` (nullable FK, `onDelete: SET NULL`) optionally links an
asset to a catalog entry; picking one in the UI prefills the free-text fields
and `assetType` at that moment, but doesn't create a live/derived relationship —
editing the free-text fields afterward doesn't touch the catalog, and editing a
catalog model's name later doesn't retroactively change any asset's stored text.
Two decoupled representations for two decoupled purposes: free text is
discovery's best guess at a point in time; the catalog is a tenant's own curated
reference list.

**Tenant-curated, not backed by an external device database.** No integration
with a manufacturer API or public hardware database — an admin creates a
manufacturer/model the first time a device needs one (the "New model" form can
create a brand-new manufacturer inline, in the same step), and reuses it after.
Consistent with not adding an external network dependency a self-hosted operator
would otherwise be stuck depending on, and avoids the scope of building/
maintaining a device-database integration for what's fundamentally a labor-
saving convenience, not a data-accuracy requirement.

**Reading the catalog is `assets:read`; creating/deleting is `assets:manage`.**
Same split as custom fields' `tickets:read`/`tickets:manage_all` — anyone
entering or editing an asset needs the picker (assets:read is what most agent
roles already have), only admin/team_lead can curate what's in it.

**Deleting a manufacturer cascades to its models, which `SET NULL`s any linked
asset's `modelId` — the asset itself is never touched otherwise.** Verified with
an automated test specifically for this, not just inferred from the schema: an
asset survives a manufacturer deletion with its name/data intact, only losing
the catalog link.

## Verified

Real Postgres, RLS confirmed via `pg_policies` for both new tables. Three
automated tests: model creation defaults, a clean duplicate-manufacturer-name
error (not a raw DB constraint message), and specifically the
delete-manufacturer-cascades-but-asset-survives behavior. Full suite 18/18
green. Browser-verified end to end: created a brand-new manufacturer + model in
one step from the Equipment Catalog page, then picked it from the new asset
form's "Catalog model" dropdown and confirmed — via a direct API read, not just
a visual check — that the created asset's `modelId`/`catalogModel` and its
prefilled `manufacturer`/`model`/`assetType` text fields were all correct.

## Consequences / known v1 limitations

- No specs field yet (RAM/CPU/etc.) — the original roadmap note mentioned specs
  as a possible future addition to `AssetModel`; not built, since nothing reads
  or needs structured specs yet.
- No bulk "assign this model to N existing assets" tool — linking happens one
  asset at a time, through the asset form.
- Editing a catalog model's name doesn't back-propagate to assets that already
  copied its old name into their free-text fields at pick time (see "Decisions"
  above) — this is deliberate decoupling, not a bug, but worth remembering if it
  ever reads as surprising.
