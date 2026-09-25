# Administration

## Users and roles

**Administration → Users** creates accounts in one of two ways:

- **Email them an invitation** (needs a connected
  [email channel](/guide/channels#email)): the person gets a link, valid
  for 7 days, to choose their own password. Until they do, the user list
  shows **Invitation pending**, with a **resend invitation** action.
- Or set an **initial password** and share it with them yourself.

People change their own password from **Account security** (the shield
icon at the bottom of the sidebar), and anyone who forgot theirs can use
**Forgot your password?** on the sign-in page to get a reset link by
email. An admin can also **reset password** from the user list. Every
password change, by any route, signs that person out of their other
sessions, so a stolen session doesn't outlive the password.

Three roles come predefined, and each one can be edited or you can create
entirely new roles from **Administration → Roles**:

| Role | Default permissions |
|---|---|
| `admin` | Everything — users, roles, tickets, assets, channels |
| `team_lead` | Tickets (including other agents'), assets, channels — no user/role management |
| `agent` | Read and reply to their own tickets, view assets — no management |

Permissions are granular (`tickets:read`, `tickets:write`,
`tickets:manage_all`, `assets:read`, `assets:manage`, `channels:manage`,
`users:manage`, `roles:manage`, `audit:read`, `contacts:manage`) — a custom role can combine them however
you need, you're not tied to the three factory-default roles.

## Single sign-on (SSO)

**Administration → Single Sign-On** lets people sign in with their
Microsoft 365 (Entra ID), Google Workspace, or any OpenID Connect account
(Okta, Auth0, Keycloak, Authentik…) instead of a separate password. You
register an app in your identity provider (the page shows the exact steps
and the **redirect URI** to register, `<your address>/api/auth/sso/callback`)
and paste its client ID and secret. For Microsoft, also paste the Directory
(tenant) ID. Sign-in is pinned to that one directory.

- **Allowed email domains**: only these domains may sign in via SSO.
- **Create accounts automatically**: the first SSO sign-in from an allowed
  domain creates the user with the role you choose. Otherwise, add people on
  the Users page first (with any password); they then sign in via SSO with
  the same email.
- **Require single sign-on**: password sign-in stops working for everyone
  except admins, who keep it as the way back in if the identity provider
  has a problem.

On the sign-in page, people type their organization and click **Sign in
with single sign-on**. Two-factor sign-in for SSO users is your identity
provider's job. Seredina doesn't ask for its own code on top.

## Two-factor sign-in

Each user can turn on two-factor sign-in under **Account security** (the
shield icon at the bottom of the sidebar): scan the QR code with an
authenticator app (Microsoft Authenticator, Google Authenticator, 1Password,
Authy…) and type the 6-digit code. From then on, sign-in asks for a code
after the password. Ten one-time **recovery codes** are shown once. Keep
them somewhere safe; each one lets you in once if you lose the phone.

On **Administration → Users**, an admin can:

- **Require two-factor sign-in for everyone.** Users who haven't set it up
  are walked through it at their next sign-in, and can't turn it off while
  it's required. You must have it on yourself first.
- **Reset** a user's two-factor sign-in when they lose their phone. They sign
  in with just their password and set it up again.

Wrong codes count toward the same 5-attempt lockout as wrong passwords.

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
