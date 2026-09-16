-- ============================================================================
-- The double-booking guarantee.
--
-- Everything else in this system is convenience. This file is the part that makes
-- an overlapping appointment physically impossible: not unlikely, not guarded by a
-- careful code path, but rejected by PostgreSQL regardless of what wrote the row —
-- application bug, stray psql session, forgotten migration in a future refactor.
--
-- Prisma cannot express an exclusion constraint, so this migration is hand-written.
-- `prisma db push` would silently drop it, which is why that command is banned in
-- this project and a test asserts the constraint still exists after a clean migrate.
-- ============================================================================

-- Needed to combine equality on a scalar (providerId) with range overlap (&&) inside a
-- single GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------------------------
-- 1. Keep the buffered interval authoritative and derived.
--
-- blockStartsAt/blockEndsAt are what actually reserve the provider calendar:
-- the appointment plus its before/after buffers. Deriving them in a trigger rather
-- than trusting the caller means the constraint below can never be bypassed by an
-- insert that simply supplies a narrower block range than the buffers imply.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointments_set_block_range() RETURNS trigger AS $$
BEGIN
  NEW."blockStartsAt" := NEW."startsAt" - make_interval(mins => NEW."bufferBeforeMin");
  NEW."blockEndsAt"   := NEW."endsAt"   + make_interval(mins => NEW."bufferAfterMin");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointments_block_range
  BEFORE INSERT OR UPDATE OF "startsAt", "endsAt", "bufferBeforeMin", "bufferAfterMin"
  ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION appointments_set_block_range();

-- Backfill for any rows written before the trigger existed.
UPDATE "appointments"
SET "blockStartsAt" = "startsAt" - make_interval(mins => "bufferBeforeMin"),
    "blockEndsAt"   = "endsAt"   + make_interval(mins => "bufferAfterMin");

-- ----------------------------------------------------------------------------
-- 2. Basic sanity, enforced at the storage layer.
-- ----------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_time_order" CHECK ("endsAt" > "startsAt");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_buffers_non_negative"
  CHECK ("bufferBeforeMin" >= 0 AND "bufferAfterMin" >= 0 AND "durationMin" > 0);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_reschedule_count_non_negative" CHECK ("rescheduleCount" >= 0);

-- An appointment may not be its own predecessor.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_reschedule_not_self" CHECK ("rescheduledFromId" IS NULL OR "rescheduledFromId" <> "id");

-- ----------------------------------------------------------------------------
-- 3. The exclusion constraint itself.
--
-- Two design points, both deliberate:
--
--   Half-open bounds '[)'. An appointment ending at 14:30 and the next starting at
--   14:30 touch but do not overlap, so back-to-back bookings with zero buffers are
--   legal. Closed bounds '[]' would reject them, which is wrong.
--
--   The WHERE predicate. Only statuses that still occupy the calendar participate.
--   A CANCELLED or RESCHEDULED appointment keeps its row — history is never
--   destroyed — but stops blocking its slot the instant its status changes.
--   This list is duplicated in TypeScript as OCCUPYING_STATUSES and a test asserts
--   the two match: drift here would either offer slots the database then rejects,
--   or silently hide bookable ones forever.
-- ----------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tstzrange("blockStartsAt", "blockEndsAt", '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'));

-- ----------------------------------------------------------------------------
-- 4. History is append-only.
--
-- The point of an audit trail is that it cannot be quietly rewritten, so the
-- database refuses UPDATE and DELETE outright rather than relying on nobody
-- writing the wrong Prisma call. Bulk cleanup in tests uses TRUNCATE, which does
-- not fire row-level triggers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION appointment_history_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'appointment_history is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appointment_history_no_rewrite
  BEFORE UPDATE OR DELETE ON "appointment_history"
  FOR EACH ROW EXECUTE FUNCTION appointment_history_immutable();

-- ----------------------------------------------------------------------------
-- 5. Supporting index for the PENDING-hold sweeper, which claims rows with
--    FOR UPDATE SKIP LOCKED and must not scan the whole table to find them.
-- ----------------------------------------------------------------------------
CREATE INDEX "appointments_pending_holds_idx"
  ON "appointments" ("holdExpiresAt")
  WHERE status = 'PENDING' AND "holdExpiresAt" IS NOT NULL;
