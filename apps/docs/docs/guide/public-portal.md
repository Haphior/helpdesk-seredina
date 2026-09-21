# Public Portal

Two public pages, no account or login, on your instance's URL — for your
customers, not for your agents.

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
