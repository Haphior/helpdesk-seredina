# Processes, Changes & Problems

## Process templates

From **Configuration → Process Templates**, you define a reusable list of
steps — for example, "New employee onboarding" with five fixed steps.
Every template has a kind:

| Kind | For |
|---|---|
| **General** | Any reusable checklist (onboarding, offboarding, an internal procedure) |
| **Change** | Change Enablement — adds a risk level, a planned window, and a rollback plan |
| **Release** | Release Management — adds a version and, optionally, the change that approved it |

## Processes (running instances)

**Processes** in the sidebar shows the active instances — a concrete
process started from a template, with its own steps marked done or
pending. If the source template gets deleted later, the instance keeps
existing with the template's name copied at creation time, so it's never
orphaned or unreadable.

### Starting a change

Starting an instance from a **Change** template requires a risk level —
it's the only mandatory field beyond the basics. A planned window
(start/end) and a rollback plan are optional but recommended: useful to
whoever reviews the change, not enforced by the system.

### Starting a release

Same as a change, but it asks for the version being deployed instead of a
risk level. A release can optionally link to the change that approved
it — the natural place a Change instance hands off to once approved.

## Problems

**Problems** tracks root causes, separate from the individual tickets a
given underlying problem generates. Each problem has a status (under
investigation, identified, resolved...), a root cause, and a workaround
while there's no permanent fix yet.

A problem can be linked to a specific ticket from the
[ticket's own detail view](/guide/tickets#the-properties-panel) — so
several tickets caused by the same underlying problem end up grouped and
visible together — and, optionally, to the change that finally fixed it
permanently: a real problem-management workflow usually ends in a change.
