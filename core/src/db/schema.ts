// Kysely row types mirroring docs/architecture/migrations/00*.sql exactly.
// Column names are snake_case because that is the authoritative schema; the
// engine's camelCase rows are mapped in pgStore.ts. Any drift between this file
// and the DDL surfaces as a compile error or a rejected insert, not silent data
// loss.

import type { Generated, GeneratedAlways } from 'kysely';

export type WorldMode = 'personal' | 'shared';
export type WorldVisibility = 'private' | 'invite_only' | 'public';
export type WorldStatusTs = 'creating' | 'active' | 'paused' | 'archived';
export type EventVisibilityTs = 'owner' | 'participants' | 'world';
export type MembershipRole = 'owner';
export type MembershipStatus = 'active' | 'invited' | 'revoked';
export type CharacterStatusTs = 'active' | 'unavailable' | 'removed';
export type ArcStatus = 'locked' | 'open' | 'resolved' | 'failed';
export type CommandStatusTs = 'committed' | 'no_op' | 'failed';
export type EpisodeStatusTs = 'pending' | 'generating' | 'validated' | 'published' | 'retrying' | 'fallback' | 'failed';
export type NarrativeQuality = 'passed' | 'rejected' | 'fallback';
export type ScheduledStatus = 'pending' | 'claimed' | 'completed' | 'failed';
export type EntitlementPlan = 'free' | 'premium';
export type IdentityStatusTs = 'active' | 'archived';

export type EventTypeTs =
  | 'world.created'
  | 'world.time_advanced'
  | 'identity.entered_world'
  | 'choice.resolved'
  | 'relationship.changed'
  | 'resource.changed'
  | 'fact.created'
  | 'fact.disclosed'
  | 'story_arc.opened'
  | 'story_arc.progressed'
  | 'story_arc.closed'
  | 'surprise.triggered'
  | 'scheduled_event.resolved';

export type CommandTypeTs =
  | 'world.create'
  | 'choice.select'
  | 'world.resume'
  | 'surprise.request'
  | 'episode.acknowledge'
  | 'world.pause'
  | 'world.archive';

export interface UsersTable {
  id: string;
  auth_uid: string | null;
  created_at: Generated<Timestamp> & Date;
}

export interface IdentitiesTable {
  id: string;
  owner_user_id: string;
  persona_schema_version: string;
  profile_json: unknown;
  status: IdentityStatusTs;
}

export interface WorldsTable {
  id: string;
  owner_user_id: string;
  mode: WorldMode;
  visibility: WorldVisibility;
  status: WorldStatusTs;
  rulepack_id: string;
  rulepack_version: string;
  blueprint_version: string;
  world_time: Date;
  version: Generated<string>;
  last_event_seq: Generated<string>;
  created_at: Generated<Timestamp> & Date;
}

export interface WorldMembershipsTable {
  world_id: string;
  user_id: string;
  identity_id: string;
  role: MembershipRole;
  status: MembershipStatus;
}

export interface WorldBlueprintsTable {
  world_id: string;
  schema_version: string;
  seed: string;
  setting_json: unknown;
  world_constraints_json: unknown;
  template_id: string;
  validated_at: Date;
}

export interface CharactersTable {
  id: string;
  world_id: string;
  owner_identity_id: string | null;
  name: string;
  status: Generated<CharacterStatusTs>;
  role_ids: Generated<string[]>;
  npc_profile_json: Generated<unknown>;
}

export interface RelationshipsTable {
  world_id: string;
  from_character_id: string;
  to_character_id: string;
  dimension: string;
  value: number;
  updated_by_event_id: string | null;
}

export interface StoryArcsTable {
  id: string;
  world_id: string;
  arc_type: string;
  status: ArcStatus;
  trigger_rules_json: Generated<unknown>;
  resolved_by_event_id: string | null;
}

export interface WorldFactsTable {
  world_id: string;
  fact_id: string;
  label: string;
  verified: Generated<boolean>;
  visibility: EventVisibilityTs;
  sensitive_phrase: string | null;
  created_by_event_id: string;
}

export interface CharacterKnowledgeTable {
  world_id: string;
  character_id: string;
  fact_id: string;
  belief_state: 'knows' | 'believes' | 'disbelieves';
  confidence: number;
  learned_by_event_id: string;
  visibility: EventVisibilityTs;
}

export interface OfferedChoicesTable {
  world_id: string;
  choice_id: string;
  bound_version: string;
  rule_id: string;
  copy: string;
}

export interface WorldEventsTable {
  event_id: string;
  world_id: string;
  world_seq: string;
  command_id: string;
  event_type: EventTypeTs;
  event_schema_version: Generated<string>;
  actor_character_id: string | null;
  caused_by_event_ids: Generated<string[]>;
  event_payload_json: unknown;
  visibility: EventVisibilityTs;
  occurred_world_time: Date;
  recorded_at: Date;
  rulepack_version: string;
}

export interface WorldSnapshotsTable {
  world_id: string;
  version: string;
  state_schema_version: Generated<string>;
  state_json: unknown;
  state_hash: string;
  last_event_seq: string;
  created_at: Date;
}

export interface CommandsTable {
  command_id: string;
  world_id: string;
  request_hash: string;
  actor_user_id: string;
  expected_world_version: string;
  command_type: CommandTypeTs;
  command_schema_version: Generated<string>;
  status: CommandStatusTs;
  result_json: unknown;
  no_op_reason: string | null;
  created_at: Date;
}

export interface NarrativeEpisodesTable {
  id: string;
  world_id: string;
  from_seq: string;
  through_seq: string;
  world_version: string;
  narrative_text: Generated<string>;
  referenced_event_ids: Generated<string[]>;
  allowed_choice_ids: Generated<string[]>;
  status: EpisodeStatusTs;
  quality_status: Generated<NarrativeQuality>;
  generation_run_id: string | null;
  created_at: Date;
}

export interface GenerationRunsTable {
  id: string;
  world_id: string;
  purpose: string;
  model_id: string;
  prompt_version: string;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  cost_usd: Generated<string>;
  latency_ms: number | null;
  validation_status: string;
  created_at: Date;
}

export interface OutboxJobsTable {
  id: GeneratedAlways<string>;
  world_id: string;
  command_id: string | null;
  episode_id: string | null;
  kind: string;
  payload_json: Generated<unknown>;
  status: Generated<'pending' | 'claimed' | 'completed' | 'failed'>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  lease_until: Date | null;
  created_at: Generated<Timestamp> & Date;
}

export interface ScheduledEventsTable {
  id: string;
  world_id: string;
  due_world_time: Date;
  event_family: string;
  rulepack_version: string;
  idempotency_key: string;
  status: Generated<ScheduledStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  lease_until: Date | null;
}

export interface EntitlementsTable {
  user_id: string;
  plan: EntitlementPlan;
  active_until: Date | null;
  source: 'platform_iap' | 'manual_grant' | 'promotion';
  max_active_worlds: number;
  verified_at: Date | null;
}

export interface OrganizationsTable {
  id: string;
  world_id: string;
  org_type: string;
  status: string;
  rules_json: Generated<unknown>;
}

export interface OrganizationMembershipsTable {
  organization_id: string;
  world_id: string;
  character_id: string;
  role: string;
  status: string;
}

export interface DeletionAuditTable {
  id: string;
  account_id: string;
  world_id: string;
  action: 'export' | 'deletion_requested' | 'deletion_completed';
  outcome_code: string;
  performed_at: Generated<Timestamp> & Date;
}

export interface OperationLogTable {
  id: GeneratedAlways<string>;
  request_id: string;
  command_id: string | null;
  world_pseudonym: string | null;
  world_version: string | null;
  rulepack_version: string | null;
  generation_run_id: string | null;
  operation: string;
  reason_code: string | null;
  latency_ms: number | null;
  cost_usd: string | null;
  recorded_at: Generated<Timestamp> & Date;
}

// Marker so a GENERATED ... AS IDENTITY default is accepted by Kysely.
type Timestamp = Date;

export interface DB {
  users: UsersTable;
  identities: IdentitiesTable;
  worlds: WorldsTable;
  world_memberships: WorldMembershipsTable;
  world_blueprints: WorldBlueprintsTable;
  characters: CharactersTable;
  relationships: RelationshipsTable;
  story_arcs: StoryArcsTable;
  world_facts: WorldFactsTable;
  character_knowledge: CharacterKnowledgeTable;
  offered_choices: OfferedChoicesTable;
  world_events: WorldEventsTable;
  world_snapshots: WorldSnapshotsTable;
  commands: CommandsTable;
  narrative_episodes: NarrativeEpisodesTable;
  generation_runs: GenerationRunsTable;
  outbox_jobs: OutboxJobsTable;
  scheduled_events: ScheduledEventsTable;
  entitlements: EntitlementsTable;
  organizations: OrganizationsTable;
  organization_memberships: OrganizationMembershipsTable;
  deletion_audit: DeletionAuditTable;
  operation_log: OperationLogTable;
}
