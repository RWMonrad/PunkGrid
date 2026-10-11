-- 001 — extensions, enums and shared helper functions
-- Implements the type vocabulary of contract section 3 and section 4.
-- Target: PostgreSQL 15+ (Supabase in EU region per ADR-011; no instance is
-- provisioned yet — see docs/architecture/migrations/README.md).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS punkgrid;
SET search_path = punkgrid, public;

CREATE TYPE world_mode AS ENUM ('personal', 'shared');
CREATE TYPE world_visibility AS ENUM ('private', 'invite_only', 'public');
CREATE TYPE world_status AS ENUM ('creating', 'active', 'paused', 'archived');
CREATE TYPE event_visibility AS ENUM ('owner', 'participants', 'world');
CREATE TYPE membership_role AS ENUM ('owner');                 -- v1: owner only (FUTURE: 'editor', 'participant')
CREATE TYPE membership_status AS ENUM ('active', 'invited', 'revoked');
CREATE TYPE character_status AS ENUM ('active', 'unavailable', 'removed');
CREATE TYPE arc_status AS ENUM ('locked', 'open', 'resolved', 'failed');
CREATE TYPE command_status AS ENUM ('committed', 'no_op', 'failed');
CREATE TYPE episode_status AS ENUM ('pending', 'generating', 'validated', 'published', 'retrying', 'fallback', 'failed');
CREATE TYPE narrative_quality AS ENUM ('passed', 'rejected', 'fallback');
CREATE TYPE scheduled_status AS ENUM ('pending', 'claimed', 'completed', 'failed');
CREATE TYPE entitlement_plan AS ENUM ('free', 'premium');
CREATE TYPE identity_status AS ENUM ('active', 'archived');

-- The thirteen canonical event types of contract section 4. V1 MUST reject
-- unknown types, so the enum is the database-side half of that rule; an
-- additive upgrade adds a value plus an upcaster (section 4).
CREATE TYPE event_type AS ENUM (
  'world.created',
  'world.time_advanced',
  'identity.entered_world',
  'choice.resolved',
  'relationship.changed',
  'resource.changed',
  'fact.created',
  'fact.disclosed',
  'story_arc.opened',
  'story_arc.progressed',
  'story_arc.closed',
  'surprise.triggered',
  'scheduled_event.resolved'
);

CREATE TYPE command_type AS ENUM (
  'world.create',
  'choice.select',
  'world.resume',
  'surprise.request',
  'episode.acknowledge',
  'world.pause',
  'world.archive'
);

-- The current wall clock is supplied by the application, never by now(), so a
-- replay of the same ledger reproduces identical rows (section 6, NFR-04).
