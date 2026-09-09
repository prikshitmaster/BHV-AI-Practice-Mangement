-- T11 (DOC01). "Quarantine a malformed archive" is named directly in the PRD
-- §15 acceptance evidence, so it gets its own coded rejection reason rather
-- than being reported as a decompression-limit or disallowed-type failure —
-- the uploader is told the real thing that is wrong with their file.
--
-- Additive and idempotent.
ALTER TYPE "RejectionReason" ADD VALUE IF NOT EXISTS 'MALFORMED_ARCHIVE';
