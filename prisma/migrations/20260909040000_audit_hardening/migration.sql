-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('FAILED_LOGIN_BURST', 'ABNORMAL_EXPORT', 'PRIVILEGE_CHANGE', 'REPEATED_CROSS_SCOPE_ACCESS', 'QUEUE_FAILURE', 'STORAGE_CAPACITY', 'BACKUP_FAILURE', 'SECRET_REVEAL');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "previousHash" TEXT,
ADD COLUMN     "sequence" BIGSERIAL NOT NULL,
ADD COLUMN     "targetVersion" INTEGER;

-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "subjectUserId" TEXT,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "incidentOwner" TEXT NOT NULL,
    "alertDestination" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAlert_kind_createdAt_idx" ON "SecurityAlert"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_practiceId_resolvedAt_idx" ON "SecurityAlert"("practiceId", "resolvedAt");

-- CreateIndex
CREATE INDEX "Event_sequence_idx" ON "Event"("sequence");

-- ============================================================================
-- SEC04 — append-only audit trail, enforced by the database.
--
-- "Keep audit events append only for the application identity, with
--  independently protected copies / integrity checks."
--
-- Two mechanisms:
--   1. Each row is chained to its predecessor by SHA-256, computed INSIDE a
--      trigger from the row's own values, so the application cannot supply a
--      forged hash. Walking the chain detects any later insertion or edit.
--   2. UPDATE and DELETE on "Event" are then rejected outright, so a
--      compromised application cannot edit or erase its own tracks.
--
-- Order matters below: the historical backfill runs BEFORE the append-only
-- triggers exist, because it necessarily writes to existing rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION bhv_event_payload(
  p_id TEXT, p_tenant TEXT, p_practice TEXT, p_actor TEXT, p_service TEXT,
  p_target_type TEXT, p_target_id TEXT, p_target_version TEXT,
  p_action TEXT, p_result TEXT, p_reason TEXT, p_created TEXT, p_prev TEXT
) RETURNS TEXT AS $$
  SELECT coalesce(p_id, '')
      || '|' || coalesce(p_tenant, '')
      || '|' || coalesce(p_practice, '')
      || '|' || coalesce(p_actor, '')
      || '|' || coalesce(p_service, '')
      || '|' || coalesce(p_target_type, '')
      || '|' || coalesce(p_target_id, '')
      || '|' || coalesce(p_target_version, '')
      || '|' || coalesce(p_action, '')
      || '|' || coalesce(p_result, '')
      || '|' || coalesce(p_reason, '')
      || '|' || coalesce(p_created, '')
      || '|' || coalesce(p_prev, 'GENESIS');
$$ LANGUAGE sql IMMUTABLE;

-- Backfill the chain for events written before this migration, in order.
DO $$
DECLARE
  r         RECORD;
  prev_hash TEXT := NULL;
  new_hash  TEXT;
BEGIN
  FOR r IN SELECT * FROM "Event" ORDER BY "sequence" ASC LOOP
    new_hash := encode(sha256(bhv_event_payload(
      r."id", r."tenantId", r."practiceId", r."actorUserId",
      r."actorServiceIdentity", r."targetType", r."targetId",
      r."targetVersion"::text, r."action", r."result"::text, r."reason",
      r."createdAt"::text, prev_hash
    )::bytea), 'hex');

    UPDATE "Event"
    SET "previousHash" = prev_hash, "hash" = new_hash
    WHERE "id" = r."id";

    prev_hash := new_hash;
  END LOOP;
END;
$$;

-- Chain every new row on insert.
CREATE OR REPLACE FUNCTION bhv_event_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash TEXT;
BEGIN
  SELECT e."hash" INTO prev_hash
  FROM "Event" e
  WHERE e."hash" IS NOT NULL
  ORDER BY e."sequence" DESC
  LIMIT 1;

  -- Any application-supplied value is discarded and replaced.
  NEW."previousHash" := prev_hash;
  NEW."hash" := encode(sha256(bhv_event_payload(
    NEW."id", NEW."tenantId", NEW."practiceId", NEW."actorUserId",
    NEW."actorServiceIdentity", NEW."targetType", NEW."targetId",
    NEW."targetVersion"::text, NEW."action", NEW."result"::text, NEW."reason",
    NEW."createdAt"::text, prev_hash
  )::bytea), 'hex');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_hash_chain
  BEFORE INSERT ON "Event"
  FOR EACH ROW EXECUTE FUNCTION bhv_event_hash_chain();

-- Now seal the table.
CREATE OR REPLACE FUNCTION bhv_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Event is append-only (SEC04): % is not permitted on the audit trail', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_no_update
  BEFORE UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION bhv_event_append_only();

CREATE TRIGGER event_no_delete
  BEFORE DELETE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION bhv_event_append_only();
