-- 006 — narrative episodes, generation runs and the transactional outbox
-- Contract sections 3, 7 and 10. Narration is materialized AFTER the canonical
-- commit, so nothing in this file may reference a version that does not exist.

SET search_path = punkgrid, public;

CREATE TABLE narrative_episodes (
  id              TEXT PRIMARY KEY,
  world_id        TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  from_seq        BIGINT NOT NULL CHECK (from_seq > 0),
  through_seq     BIGINT NOT NULL CHECK (through_seq >= from_seq),
  world_version   BIGINT NOT NULL CHECK (world_version >= 1),
  narrative_text  TEXT NOT NULL DEFAULT '',
  referenced_event_ids TEXT[] NOT NULL DEFAULT '{}',
  allowed_choice_ids   TEXT[] NOT NULL DEFAULT '{}',
  -- lifecycle state machine (section 7): pending -> generating -> validated ->
  -- published, with retrying/fallback/failed branches
  status          episode_status NOT NULL,
  -- validation outcome of the materialized prose (section 4 NarrativeEpisode)
  quality_status  narrative_quality NOT NULL DEFAULT 'rejected',
  generation_run_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  -- an accepted episode always references a committed world version and a
  -- real event interval (section 7)
  CONSTRAINT episode_version_committed FOREIGN KEY (world_id, world_version)
    REFERENCES world_snapshots(world_id, version),
  CONSTRAINT episode_interval_ordered CHECK (through_seq >= from_seq),
  -- published prose is immutable; corrections are new episodes (section 7)
  CONSTRAINT episode_published_has_text CHECK (
    quality_status NOT IN ('passed', 'fallback') OR length(narrative_text) > 0
  ),
  UNIQUE (world_id, world_version, from_seq, through_seq)
);
CREATE INDEX episodes_world_idx ON narrative_episodes(world_id, from_seq DESC);

CREATE FUNCTION narrative_episodes_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = punkgrid, public AS $$
BEGIN
  RAISE EXCEPTION 'a published episode is immutable; publish a corrected episode instead (contract section 7)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER narrative_episodes_immutable
  BEFORE UPDATE OR DELETE ON narrative_episodes
  FOR EACH ROW
  WHEN (OLD.status IN ('published', 'fallback'))
  EXECUTE FUNCTION narrative_episodes_reject_mutation();

-- Token and cost accounting with execution caps (section 1.10, FR-13).
-- A capped generation is still recorded, with zero spend and a reason code,
-- so the audit trail shows why the user got templated copy.
CREATE TABLE generation_runs (
  id               TEXT PRIMARY KEY,
  world_id         TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  purpose          TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  prompt_version   TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens    INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd         NUMERIC(10, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  latency_ms       INTEGER,
  validation_status TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX runs_world_time_idx ON generation_runs(world_id, created_at);
-- No AI write path exists: this table is written by the worker only, and the
-- grant in 008 gives no role UPDATE or DELETE on it.

ALTER TABLE narrative_episodes
  ADD CONSTRAINT episode_run_known
  FOREIGN KEY (generation_run_id) REFERENCES generation_runs(id) DEFERRABLE INITIALLY DEFERRED;

-- Transactional outbox: the commit that writes events also writes jobs, and a
-- bounded worker drains it. Handlers are idempotent (section 7).
CREATE TABLE outbox_jobs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  command_id   TEXT,
  episode_id   TEXT,
  kind         TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_until  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a job either narrates an episode or runs a world job, never both blindly
  CONSTRAINT outbox_has_target CHECK (episode_id IS NOT NULL OR command_id IS NOT NULL)
);
CREATE INDEX outbox_claim_idx ON outbox_jobs(status, created_at) WHERE status = 'pending';
