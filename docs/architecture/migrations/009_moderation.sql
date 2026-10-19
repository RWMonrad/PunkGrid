-- 009 — moderation cases (Master FR-11 / US13, Contract §15, ADR-018)
--
-- A report is not a world mutation: it appends to an operations queue and changes
-- no canonical version. The row therefore lives beside the narrative tables but
-- never in the event ledger.
--
-- §15 sets the content rule for this table: an operational record carries a
-- reason code and a pseudonymous reference, not the private story text. That is
-- why `excerpt` is a bounded fragment produced by minimiseForCase() rather than
-- the episode, and why the reviewer's action lives in `status` rather than in a
-- note that could quote the story back.

SET search_path = punkgrid, public;

CREATE TYPE moderation_reason AS ENUM (
  'sexual_content',
  'violence',
  'self_harm',
  'real_person',
  'offensive_language',
  'other'
);

CREATE TYPE moderation_status AS ENUM ('open', 'reviewing', 'actioned', 'dismissed');

-- A report names one episode inside one world, and the pair has to be a key
-- before a foreign key can point at it. Without this, a case could cite an
-- episode from a world the reporter is not in.
ALTER TABLE narrative_episodes
  ADD CONSTRAINT narrative_episodes_world_id_unique UNIQUE (world_id, id);

CREATE TABLE moderation_cases (
  id                 TEXT PRIMARY KEY,
  -- The report command id. UNIQUE, so a double-tapped report button opens one
  -- case rather than two (US13).
  command_id         TEXT NOT NULL UNIQUE,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  episode_id         TEXT NOT NULL,
  reporter_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reporter_identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  reason             moderation_reason NOT NULL,
  -- Categories the deterministic screen found in the reported prose. A reason
  -- code, not a quotation (§15).
  categories         TEXT[] NOT NULL DEFAULT '{}',
  excerpt            TEXT NOT NULL CHECK (char_length(excerpt) <= 260),
  reporter_note      TEXT CHECK (reporter_note IS NULL OR char_length(reporter_note) <= 200),
  status             moderation_status NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ,
  -- A case that has been actioned must say when, so the queue cannot silently
  -- mark work finished.
  CONSTRAINT case_review_is_stamped CHECK (status = 'open' OR reviewed_at IS NOT NULL),
  -- One report can never be filed against another world's episode: the pair is
  -- checked against the episode's own world rather than trusted from the client.
  CONSTRAINT case_episode_in_world FOREIGN KEY (world_id, episode_id)
    REFERENCES narrative_episodes(world_id, id) ON DELETE CASCADE
);

-- The reviewer queue is read in the order it arrived, world by world.
CREATE INDEX moderation_cases_queue_idx ON moderation_cases(status, created_at);
CREATE INDEX moderation_cases_world_idx ON moderation_cases(world_id, created_at);

-- Read through the same membership rule as every other world-bound table, so a
-- reporter sees their own world's cases and no one else's.
ALTER TABLE moderation_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY moderation_cases_member_read ON moderation_cases
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));

-- Writing a case is part of the request path (a report arrives over HTTP), but a
-- case is never edited by that path: the status transitions belong to the
-- reviewer service, which runs as punkgrid_owner.
GRANT SELECT, INSERT ON moderation_cases TO punkgrid_worker;
GRANT SELECT ON moderation_cases TO punkgrid_app;

