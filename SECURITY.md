# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Use GitHub's private vulnerability reporting instead: go to the
[Security tab](https://github.com/Haphior/helpdesk-seredina/security/advisories/new)
and open a new draft security advisory. This reaches the maintainer directly and
keeps the report private until there's a fix.

Include what you'd include in any good bug report: the affected version/commit,
steps to reproduce, and what you'd expect to happen instead. A proof-of-concept
against a local self-hosted instance (never against someone else's data) is the
most useful thing you can attach.

## What's in scope

This is a single-maintainer open-source project, not a company with a bug bounty
program — there's no payout, but every real report gets read and, if valid, fixed.
In scope: anything that breaks tenant isolation (see
[docs/adr/0001-multi-tenancy-rls.md](docs/adr/0001-multi-tenancy-rls.md) for how
that's supposed to hold), authentication/authorization bypasses, injection
(SQL/XSS/SSRF), and credential handling (password storage, secret encryption, API
key/webhook signing).

## Response time

No formal SLA. As a real target: an initial response within a few days, and a
fix or mitigation plan communicated before any public disclosure.

## Supported versions

There's no versioned release line yet — `main` is the only supported branch.
Fixes land there and self-hosted operators pick them up with a normal `git pull`
+ redeploy.
