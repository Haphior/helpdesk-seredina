# ADR 0060: Single sign-on over OpenID Connect

## Status

Accepted, implemented. Resolves "SSO/SAML" from the roadmap's "Other"
backlog, with OIDC instead of SAML.

## Context

Companies want staff to sign in with the account they already have
(Microsoft 365, Google Workspace), so that offboarding in one place removes
access everywhere and the company's own MFA and conditional-access policies
apply. For most buyers, SSO decides whether they adopt a tool at all.

## Decision

### OIDC, not SAML

Microsoft Entra ID, Google Workspace, Okta, Auth0, Keycloak and Authentik
all speak OpenID Connect. SAML would need XML signature validation, one of
the most error-prone areas in security code, for no provider OIDC doesn't
already cover. A small relying party on `node:crypto`
(`modules/sso/oidc.ts`) does discovery, the authorization-code flow with
PKCE, and ID token validation:

- The signature is checked against the provider's JWKS (RS256/384/512,
  ES256/384). `alg: none` and HMAC are refused.
- The discovery document must name the issuer that was asked for.
- The token must name the right issuer and audience, be unexpired (two
  minutes of skew allowed), and carry this sign-in's nonce.
- On an unknown `kid`, the JWKS is refreshed once to follow key rotation.

### Per tenant, bring-your-own app

`TenantSsoSettings` holds the provider, the issuer, the client ID, the client
secret (encrypted), allowed email domains, auto-provisioning with a default
role, and an "enforced" flag.

- **Microsoft** is pinned to one directory (tenant ID, as a GUID), never
  `common` or `organizations`. Otherwise any Entra tenant in the world could
  present an ID token for an email address in your domain.
- **Google** can be restricted to the workspace domain (`hd`), and requires
  `email_verified`.
- **Generic** issuers are tenant-supplied URLs. In cloud mode, every fetch to
  them goes through the SSRF guard. A self-hosted operator may point at an
  internal IdP, which is the same policy as the AI base URL.

### Stateless round trip, no token in any URL

1. `GET /auth/sso/start?tenantSlug=` redirects to the IdP. `state` is a
   10-minute purpose-bound HMAC token (ADR 0059's `purposeToken`) holding the
   tenant and a nonce. The PKCE verifier is an HMAC of that nonce under a
   server key, so nothing needs storing and the IdP only ever sees the
   challenge.
2. `GET /auth/sso/callback` exchanges the code (with the verifier), validates
   the ID token, and maps the email to a user. It can auto-provision the user
   if that's on, and refuses deactivated or locked accounts. It then
   redirects to the console at `/login/sso#<exchange token>`. A fragment
   never reaches a server or an access log.
3. The console `POST`s the exchange token to `/auth/sso/exchange`. The token
   is valid for 60 s and **single-use across replicas** (Redis `SET NX`), and
   the console trades it for a normal session. It also clears the fragment
   from the address bar immediately.

### Enforcement with a break-glass path

While SSO is enforced, password sign-in is refused for everyone except the
built-in `admin` role. If the IdP is down or misconfigured, an admin can
still get in and fix it. The refusal (`403 ssoRequired`) is only returned
after the password checked out, so it reveals nothing to someone guessing.

### Guardrails on auto-provisioning

The default role for auto-provisioned accounts can't carry permissions that
the admin configuring it doesn't hold (the same rule as assigning roles by
hand). Each provisioned account is audited as `user.created` via `sso`.

### MFA

An SSO sign-in doesn't additionally ask for Seredina's own TOTP (ADR 0059).
The IdP is the place to require MFA, and doubling it up only trains people
to click through prompts.

## Consequences

- Deprovisioning is by sign-in: someone disabled in the IdP can't start a
  new session, but a session already issued lasts until it expires
  (`JWT_EXPIRES_IN`, 8 h by default). SCIM provisioning and back-channel
  logout aren't implemented.
- Only authorization-code with a client secret. Private-key JWT client
  authentication isn't supported.
