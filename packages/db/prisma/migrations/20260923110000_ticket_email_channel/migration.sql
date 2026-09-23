-- Which mailbox an email ticket arrived on -- see docs/adr/0056-inbound-email-attachments.md.
ALTER TABLE "tickets" ADD COLUMN "email_channel_id" UUID;

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_email_channel_id_fkey"
  FOREIGN KEY ("email_channel_id") REFERENCES "email_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
