-- OAuth (Gmail / Microsoft 365) email channels -- see docs/adr/0057-email-oauth.md.
ALTER TABLE "email_channels"
  ALTER COLUMN "imap_password_encrypted" DROP NOT NULL,
  ALTER COLUMN "smtp_password_encrypted" DROP NOT NULL,
  ADD COLUMN "auth_type" TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN "connection_status" TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "oauth_client_id" TEXT,
  ADD COLUMN "oauth_client_secret_encrypted" TEXT,
  ADD COLUMN "oauth_microsoft_tenant" TEXT,
  ADD COLUMN "oauth_refresh_token_encrypted" TEXT,
  ADD COLUMN "oauth_access_token_encrypted" TEXT,
  ADD COLUMN "oauth_access_token_expires_at" TIMESTAMP(3);
