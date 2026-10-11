-- 002 — identity, worlds, membership and blueprint
-- Contract section 3, tables: users, identities, worlds, world_memberships,
-- world_blueprints. Authorization is enforced by the backend first (section 1.7);
-- these constraints make an unauthorized write impossible even if a handler
-- forgets, and RLS in 008 adds the read path.

SET search_path = punkgrid, public;

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  auth_uid    TEXT UNIQUE,                       -- Supabase Auth subject; opaque mapping only
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id                    TEXT PRIMARY KEY,
  owner_user_id         TEXT NOT NULL REFERENCES users(id),
  persona_schema_version TEXT NOT NULL,
  profile_json          JSONB NOT NULL,
  status                identity_status NOT NULL DEFAULT 'active',
  -- composite target for membership and character ownership FKs
  UNIQUE (id, owner_user_id)
);
CREATE INDEX identities_owner_idx ON identities(owner_user_id);

CREATE TABLE worlds (
  id              TEXT PRIMARY KEY,
  owner_user_id   TEXT NOT NULL REFERENCES users(id),
  mode            world_mode NOT NULL,
  visibility      world_visibility NOT NULL,
  status          world_status NOT NULL,
  rulepack_id     TEXT NOT NULL,
  rulepack_version TEXT NOT NULL,
  blueprint_version TEXT NOT NULL,
  world_time      TIMESTAMPTZ NOT NULL,
  -- version advances by one per successful command BATCH, not per event
  -- (section 3 database invariant). state_version in code maps to this column.
  version         BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_event_seq  BIGINT NOT NULL DEFAULT 0 CHECK (last_event_seq >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- v1 ships private personal worlds only; relaxing either value is a
  -- versioned change (section 3, FUTURE B).
  CONSTRAINT v1_personal_private CHECK (mode = 'personal' AND visibility = 'private')
);
CREATE INDEX worlds_owner_idx ON worlds(owner_user_id, status);

-- A per-world row lock is taken with SELECT ... FOR UPDATE on this row before
-- any command batch writes to world_events, world_snapshots or worlds.
CREATE TABLE world_memberships (
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  identity_id  TEXT NOT NULL REFERENCES identities(id),
  role         membership_role NOT NULL,
  status       membership_status NOT NULL DEFAULT 'active',
  PRIMARY KEY (world_id, user_id),
  -- an identity plays in a world only once; composite target for character
  -- ownership in 003 (a bare unique index cannot serve as an FK target)
  UNIQUE (world_id, identity_id),
  -- the identity behind a membership must belong to the same account
  CONSTRAINT membership_identity_is_own FOREIGN KEY (identity_id, user_id)
    REFERENCES identities(id, owner_user_id)
);
-- Exactly one active owner per world (partial unique index, section 3).
CREATE UNIQUE INDEX world_memberships_active_owner_idx
  ON world_memberships(world_id) WHERE role = 'owner' AND status = 'active';

CREATE TABLE world_blueprints (
  world_id          TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  schema_version    TEXT NOT NULL,
  seed              BIGINT NOT NULL,
  setting_json      JSONB NOT NULL,
  world_constraints_json JSONB NOT NULL,
  template_id       TEXT NOT NULL,
  validated_at      TIMESTAMPTZ NOT NULL
);
