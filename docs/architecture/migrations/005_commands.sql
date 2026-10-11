-- 005 — commands, idempotency and optimistic concurrency
-- Contract sections 3, 6 and 11. The command row is the idempotency record: a
-- repeated command with the same key and body returns the stored result instead
-- of producing new events; the same key with a different body is a conflict.

SET search_path = punkgrid, public;

CREATE TABLE commands (
  command_id            TEXT PRIMARY KEY,
  world_id              TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  request_hash          TEXT NOT NULL,
  actor_user_id         TEXT NOT NULL REFERENCES users(id),
  expected_world_version BIGINT NOT NULL CHECK (expected_world_version >= 0),
  command_type          command_type NOT NULL,
  command_schema_version TEXT NOT NULL DEFAULT '1.0',
  status                command_status NOT NULL,
  result_json           JSONB,
  no_op_reason          TEXT,
  created_at            TIMESTAMPTZ NOT NULL,
  -- a committed or no_op command always carries the result the client received
  CONSTRAINT command_result_stored CHECK (status = 'failed' OR result_json IS NOT NULL),
  UNIQUE (world_id, command_id)
);
CREATE INDEX commands_actor_idx ON commands(actor_user_id, created_at);

-- Events reference their causing command. Deferred because the command row and
-- its events are written in the same transaction, with the ledger insert first.
ALTER TABLE world_events
  ADD CONSTRAINT event_command_known
  FOREIGN KEY (command_id) REFERENCES commands(command_id)
  DEFERRABLE INITIALLY DEFERRED;

-- Reusing one idempotency key for a different body must never be silently
-- accepted (section 6). The key itself is the command_id, so uniqueness is
-- already guaranteed; this index documents the lookup the handler performs.
CREATE INDEX commands_request_hash_idx ON commands(world_id, request_hash);
