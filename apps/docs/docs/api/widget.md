# Embeddable Widget

A floating chat bubble for any website you own — no login, no API Key,
works from any domain.

## Installation

A single `<script>` tag on any page:

```html
<script src="https://your-instance.example.com/widget.js" data-tenant="your-organization"></script>
```

`data-tenant` is your organization's slug (the same one you use to log
in). That's it — no CORS configuration needed on the embedding site's
side, and no credential to generate.

## How it works

A visitor who types into the bubble creates a normal ticket in Seredina,
with `channel: "widget"` — agents see it and reply in the ticket queue
exactly like any other channel.

Conversation continuity across visits (the visitor seeing the same thread
if they come back) is handled with a random token the visitor's own
browser stores in `localStorage` — there's no account or login involved.
If the visitor clears `localStorage` or switches browsers, a new
conversation starts.

## Security

The widget deliberately works from any domain — that's what makes it
embeddable on your site with zero extra configuration — but that doesn't
weaken the rest of the API's CORS policy, which stays normally locked down
for every other endpoint. The widget's specific CORS handling is
documented in detail in `docs/adr/0040-embeddable-widget.md` if you're
curious about the technical why.
