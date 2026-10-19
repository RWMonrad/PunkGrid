-- Negative control for the canonical schema: proves the invariants in
-- 002–008 actually reject, and proves RLS hides a world from a non-member.
-- Run after the migrations, as a superuser, in one transaction:
--   psql -v ON_ERROR_STOP=1 -1 -f validate_invariants.sql
-- Every RAISE NOTICE line below is an expected rejection; a missing NOTICE is a
-- hole in the schema. The transaction rolls back at the end, so this file can
-- be re-run freely.

SET search_path = punkgrid, public;

-- The BEGIN/ROLLBACK pair is written in the file, not only left to `-1`, so an
-- invocation without it still cannot leave fixture rows behind.
BEGIN;

-- --- fixture: two worlds, one owner, one ledger row ------------------------
INSERT INTO users(id, auth_uid) VALUES ('u_owner', 'auth_owner'), ('u_intruder', 'auth_intruder');
INSERT INTO identities(id, owner_user_id, persona_schema_version, profile_json)
  VALUES ('idn_owner', 'u_owner', '1.0', '{"name":"Alex Vale"}'::jsonb);
INSERT INTO worlds(id, owner_user_id, mode, visibility, status, rulepack_id, rulepack_version,
                   blueprint_version, world_time, version, last_event_seq)
  VALUES ('w_one', 'u_owner', 'personal', 'private', 'active', 'glass-harbor', '1.0', '1.0',
          '2034-09-15T09:00:00Z', 1, 1),
         ('w_two', 'u_owner', 'personal', 'private', 'active', 'glass-harbor', '1.0', '1.0',
          '2034-09-15T09:00:00Z', 0, 0);
INSERT INTO world_memberships(world_id, user_id, identity_id, role, status)
  VALUES ('w_one', 'u_owner', 'idn_owner', 'owner', 'active');
INSERT INTO characters(id, world_id, owner_identity_id, name, status, role_ids)
  VALUES ('char_player', 'w_one', 'idn_owner', 'Alex Vale', 'active', '{founder}'),
         ('char_mara',   'w_one', NULL,                 'Mara Venn', 'active', '{cofounder}'),
         ('char_player', 'w_two', NULL,                 'Other Alex', 'active', '{}');
INSERT INTO commands(command_id, world_id, request_hash, actor_user_id, expected_world_version,
                     command_type, status, result_json, created_at)
  VALUES ('cmd_gen', 'w_one', 'hash1', 'u_owner', 0, 'world.create', 'committed', '{}'::jsonb, now());
INSERT INTO world_events(event_id, world_id, world_seq, command_id, event_type,
                         event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
  VALUES ('evt_1', 'w_one', 1, 'cmd_gen', 'world.created', '{}'::jsonb, 'world',
          '2034-09-15T09:00:00Z', now(), '1.0');
INSERT INTO world_snapshots(world_id, version, state_json, state_hash, last_event_seq, created_at)
  VALUES ('w_one', 1, '{"schemaVersion":"1.0"}'::jsonb,
          'sha256:0000000000000000000000000000000000000000000000000000000000000000', 1, now());
INSERT INTO world_facts(world_id, fact_id, label, verified, visibility, sensitive_phrase, created_by_event_id)
  VALUES ('w_one', 'fact_secret_link', 'Buyer link', TRUE, 'owner', 'procurement link', 'evt_1');
INSERT INTO character_knowledge(world_id, character_id, fact_id, belief_state, confidence, learned_by_event_id, visibility)
  VALUES ('w_one', 'char_player', 'fact_secret_link', 'knows', 100, 'evt_1', 'owner');

-- --- 1. v1 refuses a shared world -----------------------------------------
DO $$ BEGIN
  INSERT INTO worlds(id, owner_user_id, mode, visibility, status, rulepack_id, rulepack_version,
                     blueprint_version, world_time, version)
    VALUES ('w_shared', 'u_owner', 'shared', 'private', 'active', 'glass-harbor', '1.0', '1.0',
            '2034-09-15T09:00:00Z', 0);
  RAISE EXCEPTION 'invariant hole: v1_personal_private accepted a shared world';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 1: shared world rejected'; END $$;

-- --- 2. one active owner per world ----------------------------------------
DO $$ BEGIN
  INSERT INTO world_memberships(world_id, user_id, identity_id, role, status)
    VALUES ('w_one', 'u_intruder', 'idn_owner', 'owner', 'active');
  RAISE EXCEPTION 'invariant hole: a second active owner was accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok 2: second active owner rejected'; END $$;

-- --- 3. a membership identity must belong to that user ---------------------
DO $$ BEGIN
  INSERT INTO world_memberships(world_id, user_id, identity_id, role, status)
    VALUES ('w_two', 'u_intruder', 'idn_owner', 'owner', 'active');
  RAISE EXCEPTION 'invariant hole: an identity played for another account';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 3: borrowed identity rejected'; END $$;

-- --- 4. characters and relationships cannot cross worlds -------------------
DO $$ BEGIN
  INSERT INTO relationships(world_id, from_character_id, to_character_id, dimension, value)
    VALUES ('w_one', 'char_player', 'char_player', 'trust', 70);
  RAISE EXCEPTION 'invariant hole: a self relationship was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 4a: self relationship rejected'; END $$;

DO $$ BEGIN
  INSERT INTO relationships(world_id, from_character_id, to_character_id, dimension, value)
    VALUES ('w_one', 'char_player', 'char_ghost', 'trust', 70);
  RAISE EXCEPTION 'invariant hole: a foreign character was accepted (T11)';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 4b: unknown character rejected'; END $$;

DO $$ BEGIN
  INSERT INTO characters(id, world_id, owner_identity_id, name, status)
    VALUES ('char_borrowed', 'w_two', 'idn_owner', 'Wrong', 'active');
  RAISE EXCEPTION 'invariant hole: a character pointed at an identity that is not a member of that world';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 4c: character identity must be a member of the world'; END $$;

-- --- 5. relationship values stay inside [-100, 100] ------------------------
DO $$ BEGIN
  INSERT INTO relationships(world_id, from_character_id, to_character_id, dimension, value)
    VALUES ('w_one', 'char_player', 'char_mara', 'trust', 140);
  RAISE EXCEPTION 'invariant hole: trust 140 was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 5: out-of-range trust rejected'; END $$;

-- --- 6. knowledge may not reference another world's fact -------------------
DO $$ BEGIN
  INSERT INTO character_knowledge(world_id, character_id, fact_id, belief_state, confidence, learned_by_event_id, visibility)
    VALUES ('w_two', 'char_player', 'fact_secret_link', 'knows', 100, 'evt_1', 'owner');
  RAISE EXCEPTION 'invariant hole: a fact from w_one leaked into w_two';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 6: cross-world fact rejected'; END $$;

-- --- 7. the ledger is append-only -----------------------------------------
DO $$ BEGIN
  UPDATE world_events SET event_payload_json = '{"tampered":true}'::jsonb WHERE event_id = 'evt_1';
  RAISE EXCEPTION 'invariant hole: the ledger accepted an update';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 7a: event update blocked'; END $$;

DO $$ BEGIN
  DELETE FROM world_events WHERE event_id = 'evt_1';
  RAISE EXCEPTION 'invariant hole: the ledger accepted a delete';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 7b: event delete blocked'; END $$;

DO $$ BEGIN
  UPDATE world_snapshots SET state_json = '{"tampered":true}'::jsonb WHERE world_id = 'w_one' AND version = 1;
  RAISE EXCEPTION 'invariant hole: a snapshot accepted an update';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 7c: snapshot update blocked'; END $$;

-- --- 8. world_seq must advance by exactly one ------------------------------
DO $$ BEGIN
  INSERT INTO world_events(event_id, world_id, world_seq, command_id, event_type,
                           event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
    VALUES ('evt_gap', 'w_one', 4, 'cmd_gen', 'world.time_advanced', '{}'::jsonb, 'world',
            '2034-09-15T15:00:00Z', now(), '1.0');
  RAISE EXCEPTION 'invariant hole: a world_seq gap was accepted';
EXCEPTION WHEN integrity_constraint_violation THEN RAISE NOTICE 'ok 8: world_seq gap rejected'; END $$;

-- --- 9. an unknown event type cannot be stored (V1 MUST reject) ------------
DO $$ BEGIN
  INSERT INTO world_events(event_id, world_id, world_seq, command_id, event_type,
                           event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
    VALUES ('evt_bad', 'w_one', 2, 'cmd_gen', 'universe.rewound', '{}'::jsonb, 'world',
            '2034-09-15T15:00:00Z', now(), '1.0');
  RAISE EXCEPTION 'invariant hole: an unknown event type was stored';
EXCEPTION WHEN invalid_text_representation THEN RAISE NOTICE 'ok 9: unknown event type rejected'; END $$;

-- --- 10. an event must know its command ------------------------------------
DO $$ BEGIN
  SET CONSTRAINTS event_command_known IMMEDIATE;
  INSERT INTO world_events(event_id, world_id, world_seq, command_id, event_type,
                           event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
    VALUES ('evt_orphan', 'w_one', 2, 'cmd_unknown', 'world.time_advanced', '{}'::jsonb, 'world',
            '2034-09-15T15:00:00Z', now(), '1.0');
  RAISE EXCEPTION 'invariant hole: an orphan event was accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 10: event without a known command rejected'; END $$;

-- --- 11. an episode may only describe a committed version ------------------
DO $$ BEGIN
  INSERT INTO narrative_episodes(id, world_id, from_seq, through_seq, world_version,
                                 narrative_text, quality_status, status, created_at)
    VALUES ('ep_ghost', 'w_one', 1, 1, 99, 'text', 'passed', 'published', now());
  RAISE EXCEPTION 'invariant hole: an episode referenced version 99';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 11: episode for an uncommitted version rejected'; END $$;

-- --- 12. published prose is immutable --------------------------------------
INSERT INTO narrative_episodes(id, world_id, from_seq, through_seq, world_version,
                               narrative_text, quality_status, status, created_at)
  VALUES ('ep_pub', 'w_one', 1, 1, 1, 'original prose', 'passed', 'published', now());
DO $$ BEGIN
  UPDATE narrative_episodes SET narrative_text = 'edited prose' WHERE id = 'ep_pub';
  RAISE EXCEPTION 'invariant hole: a published episode was edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 12: published episode edit blocked'; END $$;

-- --- 13. a scheduled claim without a lease is invalid ----------------------
DO $$ BEGIN
  INSERT INTO scheduled_events(id, world_id, due_world_time, event_family, rulepack_version,
                               idempotency_key, status, lease_until)
    VALUES ('sch_bad', 'w_one', '2034-09-16T09:00:00Z', 'leaked_memo', '1.0', 'sch_key_1', 'claimed', NULL);
  RAISE EXCEPTION 'invariant hole: a claim without a lease was accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 13: leaseless claim rejected'; END $$;

-- --- 14. RLS: a non-member reads nothing, an owner reads their own world ---
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', 'u_intruder', true);
  IF (SELECT count(*) FROM worlds) <> 0 THEN RAISE EXCEPTION 'invariant hole: RLS exposed worlds'; END IF;
  IF (SELECT count(*) FROM world_events) <> 0 THEN RAISE EXCEPTION 'invariant hole: RLS exposed the ledger'; END IF;
  IF (SELECT count(*) FROM characters) <> 0 THEN RAISE EXCEPTION 'invariant hole: RLS exposed characters'; END IF;
  IF (SELECT count(*) FROM character_knowledge) <> 0 THEN RAISE EXCEPTION 'invariant hole: RLS exposed knowledge'; END IF;
  RESET ROLE;

  PERFORM set_config('app.user_id', 'u_owner', true);
  SET LOCAL ROLE punkgrid_app;
  -- w_two has no membership row for anyone, so even its owner_user_id cannot see it:
  -- membership, not ownership, is what the read path grants on (contract section 3).
  IF (SELECT count(*) FROM worlds) <> 1 THEN RAISE EXCEPTION 'RLS hid or leaked worlds (expected only w_one)'; END IF;
  IF (SELECT count(*) FROM world_events) <> 1 THEN RAISE EXCEPTION 'RLS hid the owners ledger'; END IF;
  IF (SELECT count(*) FROM characters) <> 2 THEN RAISE EXCEPTION 'RLS hid or leaked the cast'; END IF;
  IF (SELECT count(*) FROM character_knowledge) <> 1 THEN RAISE EXCEPTION 'RLS hid the owners knowledge'; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 14: RLS shows the member exactly w_one (1 world / 1 event / 2 characters / 1 knowledge row) and nothing of w_two';
END $$;

-- --- 15. no session user means no rows -------------------------------------
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', '', true);
  IF (SELECT count(*) FROM worlds) <> 0 THEN RAISE EXCEPTION 'invariant hole: an anonymous session read worlds'; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 15: missing app.user_id returns zero rows';
END $$;

-- --- 16. the app role has no write path to canon ---------------------------
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', 'u_owner', true);
  BEGIN
    INSERT INTO world_events(event_id, world_id, world_seq, command_id, event_type,
                             event_payload_json, visibility, occurred_world_time, recorded_at, rulepack_version)
      VALUES ('evt_app_write', 'w_one', 2, 'cmd_gen', 'world.time_advanced', '{}'::jsonb, 'world',
              '2034-09-15T15:00:00Z', now(), '1.0');
    RAISE EXCEPTION 'invariant hole: punkgrid_app wrote to the ledger';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 16a: app role cannot insert events';
  END;
  BEGIN
    UPDATE entitlements SET plan = 'premium' WHERE user_id = 'u_owner';
    RAISE EXCEPTION 'invariant hole: the app role could buy itself a plan';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 16b: app role cannot edit entitlements';
  END;
  RESET ROLE;
END $$;

-- --- 17. every world-scoped table is anchored to its world -----------------
-- A world_id without a foreign key to worlds cannot cascade, so deleting the
-- world would leave the row behind. That is both a deletion-correctness bug
-- (contract section 9) and a hydration bug: the row survives a wipe of its
-- world and is loaded again by id. deletion_audit is the one deliberate
-- exception — its world_id is a pseudonymous reference that must outlive the
-- world it records the deletion of.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'punkgrid' AND c.column_name = 'world_id'
      AND c.table_name NOT IN ('worlds', 'deletion_audit')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace nns ON nns.oid = cls.relnamespace
        WHERE nns.nspname = 'punkgrid' AND con.contype = 'f'
          AND cls.relname = c.table_name
          AND con.conkey @> ARRAY[
            (SELECT a.attnum FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attname = 'world_id')]
      )
    ORDER BY 1
  LOOP
    RAISE EXCEPTION 'invariant hole: %.world_id has no foreign key to worlds', r.table_name;
  END LOOP;
  RAISE NOTICE 'ok 17: every world-scoped table (except deletion_audit) cascades from worlds';
END $$;

-- --- 18. a report case is anchored to one world and one command ------------
-- FR-11 / US13 (ADR-018). The case names an episode, and the pair (world_id,
-- episode_id) is checked against the episode's own world: a client cannot file a
-- report that points at another account's story, and cannot open two cases with
-- one commandId.
INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                             reporter_identity_id, reason, categories, excerpt, created_at)
  VALUES ('case_ok', 'cmd_report_1', 'w_one', 'ep_pub', 'u_owner', 'idn_owner', 'violence',
          '{graphic_violence}', 'ep_pub: original prose', now());
DO $$ BEGIN
  INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                               reporter_identity_id, reason, excerpt, created_at)
    VALUES ('case_cross', 'cmd_report_2', 'w_two', 'ep_pub', 'u_owner', 'idn_owner', 'violence',
            'ep_pub: original prose', now());
  RAISE EXCEPTION 'invariant hole: a case against another world''s episode was accepted';
EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'ok 18a: cross-world episode reference rejected'; END $$;
DO $$ BEGIN
  INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                               reporter_identity_id, reason, excerpt, created_at)
    VALUES ('case_twice', 'cmd_report_1', 'w_one', 'ep_pub', 'u_owner', 'idn_owner', 'violence',
            'ep_pub: original prose', now());
  RAISE EXCEPTION 'invariant hole: one commandId opened two cases';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok 18b: a replayed report commandId is one case'; END $$;

-- --- 19. the case file stays a record, not a copy of the story -------------
-- §15: an operational record carries a reason code and a bounded reference.
DO $$ BEGIN
  INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                               reporter_identity_id, reason, excerpt, created_at)
    VALUES ('case_long', 'cmd_report_3', 'w_one', 'ep_pub', 'u_owner', 'idn_owner', 'other',
            repeat('the whole episode, ', 40), now());
  RAISE EXCEPTION 'invariant hole: a case accepted an unbounded excerpt';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 19a: oversized excerpt rejected'; END $$;
DO $$ BEGIN
  INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                               reporter_identity_id, reason, excerpt, status, created_at)
    VALUES ('case_unstamped', 'cmd_report_4', 'w_one', 'ep_pub', 'u_owner', 'idn_owner', 'other',
            'ep_pub: original prose', 'actioned', now());
  RAISE EXCEPTION 'invariant hole: a case was closed without a review stamp';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'ok 19b: actioned case without reviewed_at rejected'; END $$;

-- --- 20. RLS and the write path for moderation_cases -----------------------
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', 'u_intruder', true);
  IF (SELECT count(*) FROM moderation_cases) <> 0 THEN RAISE EXCEPTION 'invariant hole: RLS exposed a case to a non-member'; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 20a: a non-member reads no cases';
END $$;
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', 'u_owner', true);
  IF (SELECT count(*) FROM moderation_cases) <> 1 THEN RAISE EXCEPTION 'RLS hid the reporter their own case'; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 20b: the member reads the case from their own world';
END $$;
DO $$ BEGIN
  SET LOCAL ROLE punkgrid_app;
  PERFORM set_config('app.user_id', 'u_owner', true);
  BEGIN
    INSERT INTO moderation_cases(id, command_id, world_id, episode_id, reporter_user_id,
                                 reporter_identity_id, reason, excerpt, created_at)
      VALUES ('case_app_write', 'cmd_report_9', 'w_one', 'ep_pub', 'u_owner', 'idn_owner', 'other',
              'ep_pub: original prose', now());
    RAISE EXCEPTION 'invariant hole: the app role wrote a case row directly';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 20c: app role cannot insert cases';
  END;
  BEGIN
    UPDATE moderation_cases SET status = 'dismissed', reviewed_at = now() WHERE id = 'case_ok';
    RAISE EXCEPTION 'invariant hole: the app role closed a review case';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 20d: app role cannot close a case';
  END;
  RESET ROLE;
END $$;

ROLLBACK;
