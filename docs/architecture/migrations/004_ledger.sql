-- 004 — the canonical ledger and snapshots
-- Contract section 3: world_events is append-only for application roles and
-- world_snapshots records the exact committed version and final event sequence.
-- Both tables are written inside the same transaction that takes the per-world
-- row lock on worlds (section 6), so ledger and state stay consistent (NFR-04).

SET search_path = punkgrid, public;

CREATE TABLE world_events (
  event_id           TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  world_seq          BIGINT NOT NULL CHECK (world_seq > 0),
  command_id         TEXT NOT NULL,
  event_type         event_type NOT NULL,
  event_schema_version TEXT NOT NULL DEFAULT '1.0',
  actor_character_id TEXT,
  caused_by_event_ids TEXT[] NOT NULL DEFAULT '{}',
  event_payload_json JSONB NOT NULL,
  visibility         event_visibility NOT NULL,
  occurred_world_time TIMESTAMPTZ NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL,
  rulepack_version   TEXT NOT NULL,
  UNIQUE (world_id, world_seq),
  -- an acting character must belong to the world the event is written to
  CONSTRAINT event_actor_in_world FOREIGN KEY (world_id, actor_character_id)
    REFERENCES characters(world_id, id)
);
CREATE INDEX events_world_time_idx ON world_events(world_id, occurred_world_time);
CREATE INDEX events_command_idx ON world_events(command_id);
CREATE INDEX events_type_idx ON world_events(world_id, event_type);

CREATE TABLE world_snapshots (
  world_id         TEXT NOT NULL,
  version          BIGINT NOT NULL CHECK (version >= 0),
  state_schema_version TEXT NOT NULL DEFAULT '1.0',
  state_json       JSONB NOT NULL,
  state_hash       TEXT NOT NULL CHECK (state_hash ~ '^sha256:[0-9a-f]{64}$'),
  last_event_seq   BIGINT NOT NULL CHECK (last_event_seq >= 0),
  created_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (world_id, version),
  FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

-- Append-only enforcement. Corrections are compensating events, never in-place
-- edits (section 3). A TRUNCATE-capable admin role is reserved for the deletion
-- service in ADR-014; application roles get this guard.
CREATE FUNCTION world_events_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
-- A trigger body runs with the session search_path, so it must pin its own;
-- an unqualified reference would otherwise resolve against whatever the
-- connecting role happens to use.
SET search_path = punkgrid, public AS $$
BEGIN
  RAISE EXCEPTION 'world_events is append-only (contract section 3)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER world_events_append_only
  BEFORE UPDATE OR DELETE ON world_events
  FOR EACH ROW EXECUTE FUNCTION world_events_reject_mutation();

-- Snapshots are immutable once written; a re-derived snapshot is a new version.
CREATE FUNCTION world_snapshots_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = punkgrid, public AS $$
BEGIN
  RAISE EXCEPTION 'world_snapshots is immutable (contract section 3)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER world_snapshots_immutable
  BEFORE UPDATE OR DELETE ON world_snapshots
  FOR EACH ROW EXECUTE FUNCTION world_snapshots_reject_mutation();

-- Sequence discipline: world_seq must advance by exactly one per committed
-- event and worlds.last_event_seq must never move backwards.
CREATE FUNCTION world_events_seq_continues() RETURNS trigger
LANGUAGE plpgsql SET search_path = punkgrid, public AS $$
DECLARE
  prev_seq BIGINT;
BEGIN
  SELECT max(world_seq) INTO prev_seq FROM world_events WHERE world_id = NEW.world_id;
  IF prev_seq IS NULL THEN
    IF NEW.world_seq <> 1 THEN
      RAISE EXCEPTION 'first event of world % must have world_seq 1', NEW.world_id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW.world_seq <> prev_seq + 1 THEN
    RAISE EXCEPTION 'world_seq must advance by exactly one (found %, expected %)',
      NEW.world_seq, prev_seq + 1
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER world_events_seq_continues
  BEFORE INSERT ON world_events
  FOR EACH ROW EXECUTE FUNCTION world_events_seq_continues();
