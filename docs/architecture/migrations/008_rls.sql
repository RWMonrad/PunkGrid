-- 008 — roles, grants and row-level security skeleton
-- Contract section 1.7: world isolation is enforced by server authorization
-- FIRST, and RLS is the second line of defence. A policy therefore never trusts
-- a client-supplied world ownership — it re-derives it from world_memberships.
--
-- The session variable is set by the backend from the verified bearer token:
--   SET LOCAL app.user_id = '<authenticated user id>';

SET search_path = punkgrid, public;

-- Roles are cluster objects rather than schema objects, so a re-run after
-- DROP SCHEMA must not fail on them.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['punkgrid_app', 'punkgrid_worker', 'punkgrid_owner'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
-- punkgrid_app = request path (one authenticated user)
-- punkgrid_worker = outbox/scheduler worker, service identity
-- punkgrid_owner = migrations and the deletion service

-- The authenticated user id must be present for any row access; an unset
-- variable makes every policy below false.
CREATE FUNCTION punkgrid_current_user() RETURNS TEXT
LANGUAGE sql STABLE SET search_path = punkgrid, public AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

ALTER TABLE worlds              ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_blueprints    ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_arcs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_facts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE offered_choices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE commands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE narrative_episodes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_events    ENABLE ROW LEVEL SECURITY;

-- A user sees a world only through an active membership in it.
CREATE FUNCTION punkgrid_is_member(p_world_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = punkgrid, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM punkgrid.world_memberships m
    WHERE m.world_id = p_world_id
      AND m.user_id = punkgrid_current_user()
      AND m.status = 'active'
  )
$$;

CREATE POLICY worlds_member_read ON worlds
  FOR SELECT TO punkgrid_app
  USING (punkgrid_is_member(id));

CREATE POLICY memberships_member_read ON world_memberships
  FOR SELECT TO punkgrid_app
  USING (punkgrid_is_member(world_id));

-- World-scoped content tables share one read policy shape.
CREATE POLICY characters_member_read ON characters
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY relationships_member_read ON relationships
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY story_arcs_member_read ON story_arcs
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY world_facts_member_read ON world_facts
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY offered_choices_member_read ON offered_choices
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY events_member_read ON world_events
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY snapshots_member_read ON world_snapshots
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY episodes_member_read ON narrative_episodes
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));
CREATE POLICY scheduled_member_read ON scheduled_events
  FOR SELECT TO punkgrid_app USING (punkgrid_is_member(world_id));

-- Knowledge is the POV filter (section 9, FR-08): an application role reads a
-- character's beliefs only through the membership that owns that character.
CREATE POLICY knowledge_member_read ON character_knowledge
  FOR SELECT TO punkgrid_app
  USING (
    punkgrid_is_member(world_id)
    AND EXISTS (
      SELECT 1
      FROM punkgrid.characters c
      JOIN punkgrid.world_memberships m ON m.world_id = c.world_id AND m.identity_id = c.owner_identity_id
      WHERE c.world_id = character_knowledge.world_id
        AND c.id = character_knowledge.character_id
        AND m.user_id = punkgrid_current_user()
    )
  );

-- No INSERT/UPDATE/DELETE policy is defined for punkgrid_app on the canonical
-- tables: the request path writes through the service role only, so a handler
-- bug cannot turn SQL into a state mutation path (section 1.3).
GRANT USAGE ON SCHEMA punkgrid TO punkgrid_app, punkgrid_worker, punkgrid_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA punkgrid TO punkgrid_app;
GRANT SELECT, INSERT, UPDATE ON
  worlds, world_memberships, world_blueprints, characters, relationships,
  story_arcs, world_facts, character_knowledge, offered_choices,
  world_events, world_snapshots, commands, narrative_episodes,
  scheduled_events, outbox_jobs, generation_runs
  TO punkgrid_worker;
GRANT ALL ON SCHEMA punkgrid TO punkgrid_owner;
GRANT ALL ON ALL TABLES IN SCHEMA punkgrid TO punkgrid_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA punkgrid TO punkgrid_owner;

-- Billing and entitlements stay out of the simulation write path (section 3).
REVOKE UPDATE, DELETE ON entitlements FROM punkgrid_worker;
REVOKE UPDATE, DELETE ON generation_runs FROM punkgrid_worker;
REVOKE UPDATE, DELETE ON deletion_audit FROM punkgrid_worker, punkgrid_app;

-- The append-only triggers in 004 fire before privileges are consulted, so the
-- worker cannot edit the ledger either. Truncating a world's history is the
-- deletion service's job alone (ADR-014):
ALTER TABLE world_events       OWNER TO punkgrid_owner;
ALTER TABLE world_snapshots    OWNER TO punkgrid_owner;
ALTER TABLE narrative_episodes OWNER TO punkgrid_owner;
