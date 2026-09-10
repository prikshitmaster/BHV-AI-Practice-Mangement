-- T14 fix: a DRAFT invoice or credit note has no number.
--
-- Found by the T14 acceptance test, not by review: drafts were written with a
-- placeholder sequenceNumber 0, and @@unique([seriesId, sequenceNumber]) then
-- allowed exactly ONE draft per series — the second concurrent draft failed
-- with a unique violation. Postgres permits many NULLs in a unique index, so
-- NULL both models the fact ("not yet numbered") and lets unnumbered drafts
-- coexist while still forbidding two ISSUED documents sharing a number.
--
-- Widening only: NOT NULL -> NULL loses nothing, and every existing row keeps
-- the number it already has. Idempotent.

ALTER TABLE "Invoice" ALTER COLUMN "sequenceNumber" DROP NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "sequenceNumber" DROP NOT NULL;
