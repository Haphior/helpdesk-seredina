# Administration

## Users and roles

**Administration → Users** creates accounts directly (name, email,
initial password, role) — there's no email invitation flow yet, the
password gets shared outside the app.

Three roles come predefined, and each one can be edited or you can create
entirely new roles from **Administration → Roles**:

| Role | Default permissions |
|---|---|
| `admin` | Everything — users, roles, tickets, assets, channels |
| `team_lead` | Tickets (including other agents'), assets, channels — no user/role management |
| `agent` | Read and reply to their own tickets, view assets — no management |

Permissions are granular (`tickets:read`, `tickets:write`,
`tickets:manage_all`, `assets:read`, `assets:manage`, `channels:manage`,
`users:manage`, `roles:manage`) — a custom role can combine them however
you need, you're not tied to the three factory-default roles.

## Audit log

**Administration → Audit Log** lists security-relevant activity: sign-ins
(successful and failed, with IP address and browser), account lockouts,
users created, deactivated or given a new role, role changes, API keys,
webhooks, email channels, Telegram, endpoint agents, AI settings, the
knowledge base portal settings, and full data exports. Each entry shows who
did it, to what, when, and from where. Secrets are never logged: changing
an API key records *that* it changed, not its value.

Entries are append-only: the application's own database role can insert and
read them, never change or delete them. Viewing the log needs the
`audit:read` permission, which the built-in admin role has (including on
existing installs, after upgrading).

## API Keys

**Administration → API Keys** — for external integrations, not for human
agents. See [Authentication](/api/#api-keys-for-integrations-what-you-want)
for the full detail.

## Custom fields

**Configuration → Custom Fields** — define extra fields that show up in
every ticket's properties panel. Five available types: text, number,
yes/no, date, and a list of options. A custom field can also be attached
to a [service catalog item](/guide/service-catalog#service-catalog-requests),
so different kinds of requests ask for different data.

## Appearance

**Administration → Appearance** — two visual themes for the whole
console, with immediate effect for anyone who has it open:

- **Meet in the Middle** (default) — a warm stone palette, with a
  three-circle glyph on each ticket showing which channel it arrived
  through.
- **Refined** — the original look, a cool slate palette, no glyph.

It's a per-tenant preference, not per person — every agent at the same
organization sees the same theme.

## White-labeling

**Administration → Branding** — your own logo and accent color, visible
on the [self-service portal and public status page](/guide/public-portal)
your customers see. The internal agent console keeps Seredina's own
identity — white-labeling is for the customer-facing surfaces, not for
replacing the brand inside the building.

## Language

A language selector lives at the bottom of the sidebar — it's a **per
person** preference, saved in the browser, not per tenant: two agents on
the same team can use the console in different languages without
stepping on each other. Today it covers English and Spanish, on the
highest-traffic screens (login, navigation, dashboard, tickets) — the
rest of the console is still English-only.
