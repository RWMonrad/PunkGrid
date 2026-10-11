-- 003 — cast: characters, relationships, arcs, facts and knowledge
-- Contract section 3. Every record carries world_id, and same-world integrity is
-- expressed as composite foreign keys, so a row can never point at another
-- world's character or fact (section 3 database invariant, golden test T11).
--
-- world_facts and offered_choices are DERIVED PROJECTIONS (ADR-015): the
-- authoritative record of a fact is its fact.created / fact.disclosed event.
-- They exist so reads and narrative validation do not fold the whole ledger.

SET search_path = punkgrid, public;

CREATE TABLE characters (
  id                TEXT NOT NULL,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  owner_identity_id TEXT,
  name              TEXT NOT NULL,
  status            character_status NOT NULL DEFAULT 'active',
  role_ids          TEXT[] NOT NULL DEFAULT '{}',
  npc_profile_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (world_id, id),
  -- an owned character's identity must live in the same world
  CONSTRAINT character_identity_same_world FOREIGN KEY (world_id, owner_identity_id)
    REFERENCES world_memberships(world_id, identity_id)
);
CREATE INDEX characters_world_idx ON characters(world_id, status);

-- Character resource counters live in the snapshot state (section 6); they are
-- not a table, so a resource change is always an event.

CREATE TABLE relationships (
  world_id          TEXT NOT NULL,
  from_character_id TEXT NOT NULL,
  to_character_id   TEXT NOT NULL,
  dimension         TEXT NOT NULL,
  value             SMALLINT NOT NULL CHECK (value BETWEEN -100 AND 100),
  updated_by_event_id TEXT,
  PRIMARY KEY (world_id, from_character_id, to_character_id, dimension),
  CONSTRAINT relationship_from_in_world FOREIGN KEY (world_id, from_character_id)
    REFERENCES characters(world_id, id),
  CONSTRAINT relationship_to_in_world FOREIGN KEY (world_id, to_character_id)
    REFERENCES characters(world_id, id),
  CONSTRAINT relationship_no_self_loop CHECK (from_character_id <> to_character_id)
);

CREATE TABLE story_arcs (
  id                 TEXT PRIMARY KEY,
  world_id           TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  arc_type           TEXT NOT NULL,
  status             arc_status NOT NULL,
  trigger_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_by_event_id TEXT,
  -- locked -> open -> resolved|failed is the only legal path (section 7)
  CONSTRAINT arc_no_backward_jump CHECK (
    CASE status
      WHEN 'locked'   THEN TRUE
      WHEN 'open'     THEN resolved_by_event_id IS NULL
      WHEN 'resolved' THEN resolved_by_event_id IS NOT NULL
      WHEN 'failed'   THEN resolved_by_event_id IS NOT NULL
    END
  )
);
CREATE INDEX story_arcs_world_idx ON story_arcs(world_id, status);

-- ADR-015: projection of fact.created / fact.disclosed payloads.
CREATE TABLE world_facts (
  world_id         TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  fact_id          TEXT NOT NULL,
  label            TEXT NOT NULL,
  verified         BOOLEAN NOT NULL DEFAULT TRUE,
  visibility       event_visibility NOT NULL,
  -- prose marker the narrative validator watches for; never shown to clients
  sensitive_phrase TEXT,
  created_by_event_id TEXT NOT NULL,
  PRIMARY KEY (world_id, fact_id)
);

CREATE TABLE character_knowledge (
  world_id         TEXT NOT NULL,
  character_id     TEXT NOT NULL,
  fact_id          TEXT NOT NULL,
  belief_state     TEXT NOT NULL CHECK (belief_state IN ('knows', 'believes', 'disbelieves')),
  confidence       SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  learned_by_event_id TEXT NOT NULL,
  visibility       event_visibility NOT NULL,
  PRIMARY KEY (world_id, character_id, fact_id),
  CONSTRAINT knowledge_character_in_world FOREIGN KEY (world_id, character_id)
    REFERENCES characters(world_id, id),
  CONSTRAINT knowledge_fact_in_world FOREIGN KEY (world_id, fact_id)
    REFERENCES world_facts(world_id, fact_id)
);

-- ADR-015: the choices currently offered to the player, refreshed at commit.
-- bound_version makes a stale choice id rejectable (section 11, FR-04).
-- choice_id is a rulepack identifier, not a row reference, so it is not FK'd.
CREATE TABLE offered_choices (
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  choice_id     TEXT NOT NULL,
  bound_version BIGINT NOT NULL CHECK (bound_version >= 0),
  rule_id       TEXT NOT NULL,
  copy          TEXT NOT NULL,
  PRIMARY KEY (world_id, choice_id)
);
