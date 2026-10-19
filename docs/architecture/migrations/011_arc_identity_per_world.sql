-- 011 — a story arc is a row of one world
-- 003 declares that every record carries world_id and that same-world integrity is
-- expressed as composite keys, but story_arcs kept `id TEXT PRIMARY KEY` while its
-- ids come from the rulepack template ('arc_acquisition', …). Every world created
-- from the same template therefore upserted the same three rows: one world owned an
-- arc record and every later create overwrote its status. It also made each create
-- transaction wait on those three shared rows.
--
-- Nothing has an arc_id foreign key, so widening the key needs no other table. The
-- rows already written cannot be attributed to a world — the loser of each upsert
-- left no trace — so they are dropped and rebuilt per world from the latest
-- snapshot, which is the authoritative per-world arc status (section 3; the same
-- reading ADR-015 gives world_facts).

SET search_path = punkgrid, public;

ALTER TABLE story_arcs DROP CONSTRAINT story_arcs_pkey;
DELETE FROM story_arcs;
ALTER TABLE story_arcs ADD PRIMARY KEY (world_id, id);

-- The templates each shipped rulepack establishes. A world whose rulepack is not
-- listed here gets no rows, which is honest: its arcs are unknown, not invented.
WITH templates (rulepack_id, id, arc_type) AS (
  VALUES
    ('glass-harbor-2034', 'arc_acquisition',  'acquisition'),
    ('glass-harbor-2034', 'arc_hidden_link',  'hidden_link'),
    ('glass-harbor-2034', 'arc_staff_security', 'staff_security')
), latest AS (
  SELECT DISTINCT ON (world_id) world_id, state_json
  FROM world_snapshots
  ORDER BY world_id, version DESC
)
INSERT INTO story_arcs (id, world_id, arc_type, status, resolved_by_event_id)
SELECT t.id, l.world_id, t.arc_type,
       (l.state_json #>> ARRAY['arcStatuses', t.id])::arc_status,
       (SELECT e.event_id FROM world_events e
         WHERE e.world_id = l.world_id
           AND e.event_type = 'story_arc.closed'
           AND e.event_payload_json ->> 'arcId' = t.id
         ORDER BY e.world_seq DESC LIMIT 1)
FROM latest l
JOIN worlds w ON w.id = l.world_id
JOIN templates t ON t.rulepack_id = w.rulepack_id
WHERE l.state_json #> ARRAY['arcStatuses', t.id] IS NOT NULL;
