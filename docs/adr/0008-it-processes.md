# ADR 0008: IT processes/procedures — a separate model, not a Macro or a Ticket

## Status

Accepted, implemented. Resolves the previously-vague "Governance Helping" GLPI
backlog item now that there's concrete direction: multi-step checklists for
things like employee onboarding or a commercial document approval chain.

## Context

Requested directly, with two examples: onboarding, and commercial document
approval. Both share a shape neither `Ticket` nor the planned `Macro` fits:
a named sequence of steps, each independently assigned/completed, that runs
over days or weeks and may need an approval rather than just a completion.

## Decisions

**A new model family (`ProcessTemplate`/`ProcessStepTemplate`/`ProcessInstance`/
`ProcessStepInstance`), not a reuse of `Ticket`.** A ticket is a conversation
thread with a status; a process is a checklist with no conversation at all.
Forcing one into the other (e.g. modeling steps as ticket messages) would mean
every consumer of `Ticket` has to reason about a second, incompatible meaning
for its own fields. Deliberately also not the same as `Macro` (still unbuilt,
Phase 2): a Macro is a one-shot bundle of actions applied instantly to a single
existing ticket; a process is multi-step and multi-person and can outlive any
one ticket, or touch several.

**Instances copy their steps' labels and `requiresApproval` from the template at
creation time**, same reasoning as custom fields snapshotting nothing but
processes need it more: a process can run for weeks, and an admin editing the
template mid-flight must never rewrite a step already in progress elsewhere.

**`ProcessInstance.processTemplateId` is nullable with `onDelete: SetNull`, not
the schema's default `Cascade` for a required relation — caught before writing
any service code, not after.** Prisma's default for a required FK deletes the
child when the parent goes; here the "child" is a running or completed process
(e.g. "Jane Doe's onboarding") and the "parent" is just its template. Applying
the default would have meant deleting a template silently deleted every process
ever started from it. Fixed by making the relation optional (`SET NULL`) and
adding a `templateName` snapshot column so the instance stays fully readable
even after its template is gone — verified with a test that specifically starts
an instance, deletes its template, and asserts the instance and all its steps
are still there.

**A step marked `requiresApproval` cannot be closed as plain `DONE`** — it must
resolve to `APPROVED` or `REJECTED`. Enforced in the service layer
(`updateProcessStep`), not just left to the UI to respect, so no other caller
can silently skip it.

**The instance auto-completes when its last step reaches a terminal state, and
auto-reopens (back to `IN_PROGRESS`) if a step is reopened afterward.** No
separate "mark process done" action to forget; and no stuck state where the
instance says `COMPLETED` while a step underneath it says `PENDING`.

**Templates are `tickets:manage_all` (configuration); instances are
`tickets:write` (day-to-day work).** Same split already established for custom
fields and the equipment catalog — defining a process is tenant configuration,
starting and working one is what any agent already does.

**No ticket-linking UI in this pass, even though the schema supports it.**
`ProcessStepInstance.ticketId` exists and the `PATCH /process-steps/:id`
endpoint accepts it — "a step that needs real IT work can link a ticket" was
part of the original ask — but building a ticket picker (or a "create and
link" flow) is real additional UI scope on top of an already-substantial
feature. Shipping the backend capability now and the picker later, honestly,
beat quietly dropping the idea or padding this pass to include it.

## Verified

Real Postgres, RLS confirmed for all four new tables. 5 automated tests: step
ordering on creation, duplicate-name and empty-steps rejection, the
template-delete-preserves-instances behavior (the bug described above, caught
and fixed before it shipped), the approval-guard rejecting a plain `DONE`, and
specifically the auto-complete/auto-reopen symmetry across a two-step instance.
Full suite 23/23 green. Browser-verified end to end: created a 3-step template
(one requiring approval) with a brand-new team-less step each, started an
instance, drove it through all three steps (including confirming the approval
step's status dropdown never even offers `DONE` as an option), and confirmed
the instance auto-completed — zero console errors throughout.

## Consequences / known v1 limitations

- No ticket-linking UI (see above) — the mechanism exists, the picker doesn't.
- No due dates / SLA on individual steps or the instance as a whole.
- No notifications when a step is assigned or a process completes.
- `CANCELLED` exists in `ProcessInstanceStatus` but has no endpoint to reach it
  yet — reserved for a future "cancel this process" action, not wired up.
- No way to reorder or edit an existing template's steps after creation (only
  create-with-steps and delete-whole-template) — editing a template is
  currently "delete and recreate."
