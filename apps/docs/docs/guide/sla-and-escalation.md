# SLA & Escalation

## SLA policies

From **Configuration → SLA Policies**, you define, per priority
(Low/Normal/High/Urgent), how many minutes the first response and the
resolution are due in. Each priority has its own policy — an urgent
ticket typically has much tighter deadlines than a low-priority one.

Each policy has a **business hours only** toggle: when on, the time
count pauses outside the schedule configured in **Operations → Business
Hours** (timezone and windows per day of the week) — an urgent ticket
opened on a Friday night doesn't start "aging" until the office reopens.

## How it shows up on a ticket

In a [ticket detail's properties panel](/guide/tickets#the-properties-panel),
if an SLA policy applies, it shows when the first response and resolution
were met (in green) or when they're due if they haven't happened yet (in
red if already overdue). In the ticket queue, a clock icon next to the
subject flags tickets with a breached SLA, without needing to open each
one.

## Escalation

Escalation is a chain of tiers (**Operations → On-Call & Escalation**),
each with its own wait time. A tier can point at a specific person or at
an [on-call schedule](#on-call) — if nobody acknowledges within the
current tier's time, it automatically moves to the next one.

A ticket with active escalation shows a banner in its detail view with an
**Acknowledge** button — any agent with access can acknowledge it, which
stops it from advancing to further tiers. If every tier is exhausted
without anyone acknowledging, the escalation lands in an exhausted state —
a dead end in this version, it doesn't retry.

## On-call

An on-call schedule defines who's on duty at any given moment — an
escalation tier can point at a schedule instead of a fixed person, so the
alert always reaches whoever's on call that week, without having to
reconfigure the escalation chain every time the rotation changes.
