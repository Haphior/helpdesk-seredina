# CSAT Surveys

When a ticket moves to a resolved status, Seredina automatically
generates a satisfaction survey link (1 to 5 stars, plus an optional
comment) and delivers it to the contact through whichever channel they
were already talking on — email, Telegram, or the widget conversation —
with no extra configuration on your part. It's requested **at most once
per ticket**, never re-sent.

::: tip Requires `WEB_ORIGIN` to be set
Without that environment variable, the survey simply doesn't get
generated — it degrades silently, it doesn't break the rest of the ticket
resolution flow. See
[Environment Variables](/deployment/environment-variables#networking-and-ports).
:::

## Where it shows up

- The average of every response, last 90 days, in the
  **Customer satisfaction** widget on the [dashboard](/guide/reports-and-dashboard).
- A response to a specific survey doesn't appear as a normal ticket
  message — it's a separate record, meant to be aggregated in reports,
  not reviewed ticket by ticket.

## The contact's side

The link leads to a simple public page, no account or login needed — the
token in the URL is the only credential, the same pattern the chat widget
uses to identify a conversation without requiring a session.
