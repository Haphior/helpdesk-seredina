# Contacts and Personal Data

**Contacts** (in the sidebar, under Tickets) lists the people who write in,
by any channel. Search by name or email and open one to see their tickets.
The contact's name on a ticket links there too.

Data protection laws, such as Chile's Ley 21.719, GDPR and Brazil's LGPD,
give people the right to get a copy of their data, correct it, or have it
erased. The **Personal data** panel on a contact's page covers all three.
It's visible to roles with the **Manage contacts' personal data**
permission, which admins have.

## Correcting a contact

**Edit** changes the name or email. Two contacts can't share an address.

## Giving someone a copy of their data

**Download data** saves a JSON file containing:
- their details;
- their tickets (subject, status, dates, custom fields, satisfaction
  rating and comment);
- the conversation, with the names of any attachments.

Internal notes are left out unless you tick **Include internal notes**.
They're your team's working notes, so read them before you send them.

## Erasing someone's data

**Anonymize contact** erases the contact's personal data. To confirm, type
their email address. **It can't be undone.**

What's removed:
- their name and email;
- on every one of their tickets: the subject, every message (including
  your team's replies and internal notes, since those quote the customer),
  attachments, custom field values, and the satisfaction comment.

What stays: the tickets themselves, as empty records with their number,
status, team, assignee, dates, SLA times and satisfaction rating. Your
reports and statistics don't change after the fact.

If the same address writes in again later, they're treated as a new contact.

::: warning Copies outside Seredina
Anonymizing doesn't reach copies made elsewhere:
- database backups, until they rotate out;
- emails already sent;
- data your webhooks delivered to other systems;
- knowledge base articles written from a ticket.
:::

## Automatic retention

At the top of the Contacts page, admins can turn on **automatic retention**:
contacts with no open ticket and no activity for a set number of days
(between 30 and 3650) are anonymized automatically. The check runs every few
hours. It's off by default.

Every export, correction and anonymization, manual or automatic, appears in
the [audit log](/guide/administration#audit-log). The log names the contact
only by an internal id, so it doesn't keep what was erased.
