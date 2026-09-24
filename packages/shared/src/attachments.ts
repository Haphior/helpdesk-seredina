// Bytes live directly in Postgres (see schema.prisma's Attachment model comment
// for why there's no object-storage bucket in this stack yet) -- these two caps
// are what keep that bounded until real volume justifies standing one up.
// Shared so the API's upload path and the worker's inbound-email path enforce
// the same limits.
export const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
