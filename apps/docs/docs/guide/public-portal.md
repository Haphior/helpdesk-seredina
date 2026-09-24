# Public Portal

Public pages on your instance's URL — for your customers, not for your
agents. The knowledge base and status page need no sign-in; the customer
portal uses a link sent by email.

## Customer portal

`/portal/your-organization` — where the people you support follow their
own requests. Turn it on under **Administration → Customer Portal** (it's
off by default, and needs a connected [email channel](/guide/channels#email)
because sign-in links go out by email).

- **No passwords.** A customer types their email and gets a one-time
  sign-in link, valid for 20 minutes. The first time an address signs in, it
  becomes a contact. The sign-in page gives the same answer whether or not
  the address has tickets, and each address is limited to 3 links per hour.
- They see **only their own tickets** and only the **public conversation**,
  never internal notes. They can reply (a reply to a closed ticket reopens
  it), attach a file, open a new request, and request items from the
  [service catalog](/guide/service-catalog).
- Agent replies to a portal ticket are also **emailed** to the customer, so
  they don't have to keep checking. Replying to that email lands on the same
  ticket.
- A portal session lasts 7 days and only works on the portal it was issued
  for. It's a portal-only credential, never a console session.

## Public knowledge base

`/kb/your-organization` — every article published from the
[internal knowledge base management](/guide/knowledge-base) screen, with
its own search. Nothing extra to configure: publishing an article makes
it show up there automatically.

## Status page

`/status/your-organization` — shows the status of every configured
[business service](/guide/service-catalog#services-service-configuration)
(operational, degraded, or down).

::: tip Maintains itself, no manual work
There's no button to "mark a service as down" — the status is computed
automatically from whether there are open **alert**-channel tickets
linked to the assets that underpin that service. High or Urgent priority
on the alert marks the service as down; any other open alert marks it
degraded; no open alerts, operational. Set up your
[Services](/guide/cmdb-and-assets) and your
[monitoring alerts](/guide/channels#monitoring-alerts-noc-soc) once, and
the status page stays correct from then on by itself.
:::

An anonymous visitor only ever sees the service name and its status
color — never the subject or description of the ticket affecting it. A
routine ticket ("replace a keyboard") linked to the same asset doesn't
affect the public status — only tickets that arrived through the alert
channel count.

## Branding on public pages

If you've set up [white-labeling](/guide/administration#white-labeling),
both public pages show your logo and accent color instead of Seredina's —
it's exactly the surface that's meant for.
