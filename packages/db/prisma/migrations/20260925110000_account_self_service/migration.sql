-- Account self-service: password change and reset, emailed invitations, and
-- ending other sessions when a password changes -- see
-- docs/adr/0067-account-self-service.md.
ALTER TABLE "users"
  ADD COLUMN "sessions_valid_after" TIMESTAMP(3),
  ADD COLUMN "invited_at" TIMESTAMP(3);
