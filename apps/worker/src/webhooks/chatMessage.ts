import type { ChatWebhookEvent } from '@seredina/shared';

/**
 * Plain text only, no Markdown -- Slack's mrkdwn dialect (`*bold*`) and
 * Teams' standard Markdown (`**bold**`) disagree on syntax, and this project
 * has no reason to pick one over the other for a one-line notification.
 * Emoji + punctuation carry the same "this needs attention" signal without
 * betting on either platform's dialect. See docs/adr/0048-chat-notifications.md.
 */
export function formatChatMessage(event: ChatWebhookEvent, data: Record<string, unknown>): string {
  switch (event) {
    case 'ticket.created':
      return `🎫 New ticket #${data.number}: ${data.subject}`;
    case 'sla.first_response_breached':
      return `⏰ SLA breach (first response) — ticket #${data.number}: ${data.subject}`;
    case 'sla.resolution_breached':
      return `⏰ SLA breach (resolution) — ticket #${data.number}: ${data.subject}`;
  }
}
