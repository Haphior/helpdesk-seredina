-- Two-factor sign-in (TOTP) -- see docs/adr/0061-mfa-totp.md.
ALTER TABLE "users"
  ADD COLUMN "mfa_secret_encrypted" TEXT,
  ADD COLUMN "mfa_pending_secret_encrypted" TEXT,
  ADD COLUMN "mfa_enabled_at" TIMESTAMP(3),
  ADD COLUMN "mfa_last_used_step" INTEGER,
  ADD COLUMN "mfa_recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "tenants" ADD COLUMN "mfa_required" BOOLEAN NOT NULL DEFAULT false;
