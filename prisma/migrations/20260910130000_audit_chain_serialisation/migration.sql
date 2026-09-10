-- ============================================================================
-- SEC04 — the audit hash chain must not fork under concurrency.
--
-- Found by T15's regression run: `verifyChain` reported "previousHash does not
-- match the preceding row's hash" at sequence 2346. Two Event rows inserted
-- 2ms apart both carried previousHash = the hash of row 2344, because the
-- chaining trigger read "the row with the highest sequence" without holding
-- anything against a concurrent insert doing the same. Both then hashed
-- against the same predecessor and the chain forked.
--
-- This is not a corrupted audit trail — every audited FACT is intact. It is
-- the tamper-evidence mechanism failing to be evidence: a chain that forks on
-- its own cannot distinguish a fork from an interfering write, so the control
-- reports interference that did not happen and would be ignored when it did.
--
-- Two parts below: serialise the chain so it cannot fork again, then rebuild
-- the existing chain so the verifier has a clean baseline.
-- ============================================================================

-- Part 1: serialise. A transaction-level advisory lock, taken before the
-- previous hash is read and released at commit, is what makes "read the last
-- hash, then link to it" atomic. There is exactly one lock and every inserter
-- takes it first, so there is no ordering to deadlock over.
CREATE OR REPLACE FUNCTION bhv_event_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bhv_event_hash_chain')::bigint);

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

-- Part 2: rebuild the chain over the rows that already exist.
--
-- The append-only trigger has to be dropped for the duration and put back
-- immediately, which is the reason this is a migration and not a script: it is
-- recorded, reviewable, and runs once. Only `hash` and `previousHash` are
-- written. Nothing that was audited — actor, action, target, version, result,
-- reason, time — is touched, and the recomputation reads those columns as they
-- stand, so a row altered before this ran would still be carried forward as
-- altered rather than being laundered by the rebuild.
--
-- On a production restore this rebuild would NOT be the right response to a
-- chain failure: there, the fork is the finding. It is right here because the
-- fork's cause is known, fixed above, and the data is fictional development
-- data. BCP04's restore reconciliation is where a real chain break gets its
-- own answer.
DROP TRIGGER IF EXISTS event_no_update ON "Event";

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

CREATE TRIGGER event_no_update
  BEFORE UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION bhv_event_append_only();
