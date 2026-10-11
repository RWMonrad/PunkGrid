# PunkGrid — Reality Engine Core Contract v1.0

**Status:** Proposed / implementation-ready baseline, pending architecture review  
**Date:** 2026-10-11  
**Scope:** Personal Multiverse (A), structurally compatible with future Living Multiverse (B).  
**Normative language:** MUST / MUST NOT = required for v1. SHOULD = desired. FUTURE = not implemented in v1.

## 0. Product invariant

PunkGrid is a persistent interactive simulation, not a chatbot with long memory. Narrative text describes committed canonical events; it does not itself mutate canonical state. Every important user choice must cause a valid, persistent and testable change or explicitly produce a no-op outcome with a stated reason.

### Product experience, release A
- One private active world per free account; support additional worlds through entitlements in the data model.
- Two entry paths: **Create a Life** and **Surprise Me**, both producing identical domain structures.
- English, mobile-first, text episodes with optional bounded visuals.
- A world comprises a setting, rule pack, characters, relationships, resources, story arcs, event history, world clock and current snapshot.
- Choice-based experience, not unrestricted AI agents acting autonomously.
- World advancement on session resume or due scheduled jobs, subject to a hard tick and spend budget.
- No multiplayer or user-to-user events in v1; shared-world architecture is reserved, not claimed implemented.

### Deliberate non-goals v1
Open-world 3D, video, continuous agent simulation, real-time multiplayer, arbitrary inter-world mergers, player commerce, historically verified education, unrestricted user-generated worlds, globally shared lore, and public social profiles.

## 1. Fundamental architectural decisions

1. Implement a **modular monolith**, with separate domain, simulation, narrative, persistence, jobs and identity boundaries.
2. PostgreSQL is authoritative; event ledger and state snapshot are transactionally consistent.
3. All state-mutating actions are represented by validated commands; only the domain simulation module applies state changes.
4. Narrative AI is untrusted, nondeterministic content production. It may propose constrained alternatives, but never directly apply arbitrary patches, execute SQL, or edit entitlement and access-control states.
5. Version all rulesets, schemas, prompts, model settings and world-blueprint formats.
6. UUID/ULID opaque identifiers, stable across client, server and event log. No hardcoded user profile details in world payloads.
7. World isolation enforced by server authorization and PostgreSQL RLS where appropriate; never trust client-supplied actor ownership.
8. Domain commands MUST be idempotent. Concurrent commands MUST not both commit against the same world version.
9. A single authoritative world clock is used per world; wall-clock, world-clock and narrative playback positions remain separate.
10. Record AI token usage, monetary costs and model version per generation, with execution caps.

## 2. Domain vocabulary

- **User:** real account holder.
- **Identity:** a fictive or alternate persona owned by a user; not interchangeable with auth identity.
- **World:** canonical simulation instance and its access policy.
- **Membership:** one user's role and selected identity within a world. V1 cardinality: only owner membership permitted for private worlds.
- **Blueprint:** validated, versioned genesis inputs and world constraints.
- **Character:** player-controlled persona or NPC instance within a world.
- **Fact:** a canonical assertion with source-event provenance and visibility. Characters' *beliefs* are not necessarily facts.
- **World state:** current validated resources, relationships, plot conditions and clocks.
- **Domain event:** immutable record of a committed change, ordered by `world_seq`.
- **Command:** user or scheduler intent requesting a state transition.
- **Story arc:** narrative objective with explicit unlock and closure conditions.
- **Narrative episode:** prose/materialization of one or more committed events, labeled with the exact version it describes.
- **Surprise:** constrained event candidate selected from eligible event families and committed by normal rules.

## 3. Canonical data model (logical)

### Core relational entities

| Table | Core fields / constraints |
|---|---|
| `users` | `id PK`, auth mapping, created timestamp |
| `identities` | `id PK`, `owner_user_id FK`, `persona_schema_version`, `profile_json`, status |
| `worlds` | `id PK`, `owner_user_id FK`, `mode ENUM(personal,shared)`, `visibility ENUM(private,invite_only,public)`, `status`, `rulepack_id`, `rulepack_version`, `world_time`, `version BIGINT >= 0`, `created_at`; v1 must have `mode=personal`, `visibility=private` |
| `world_memberships` | `(world_id,user_id) PK`, `identity_id FK`, `role`, `status`; uniqueness for active owner per world; v1 permits owner only |
| `world_blueprints` | `world_id PK/FK`, `schema_version`, `seed`, `setting_json`, `world_constraints_json`, `validated_at` |
| `characters` | `id PK`, `world_id FK`, `owner_identity_id nullable`, `npc_profile_json`, current status |
| `relationships` | `(world_id,from_character_id,to_character_id,dimension) UNIQUE`, `value`, `updated_by_event_id`; both characters must belong to same world |
| `world_events` | `event_id PK`, `(world_id,world_seq) UNIQUE`, `command_id`, `event_type`, `event_schema_version`, `actor_character_id nullable`, `caused_by_event_ids`, `event_payload_json`, `visibility`, `occurred_world_time`, `recorded_at`, `rulepack_version` |
| `world_snapshots` | `(world_id,version) PK`, `state_schema_version`, `state_json`, `state_hash`, `last_event_seq`, `created_at` |
| `commands` | `command_id PK`, `world_id`, `request_hash`, `actor_user_id`, `expected_world_version`, `command_type`, `command_schema_version`, `status`, `result_json`, `created_at`; `UNIQUE(world_id,command_id)` |
| `story_arcs` | `id PK`, `world_id`, `arc_type`, `status`, `trigger_rules_json`, `resolved_by_event_id nullable` |
| `character_knowledge` | `(world_id,character_id,fact_id) PK`, `belief_state`, `confidence`, `learned_by_event_id`, `visibility` |
| `scheduled_events` | `id PK`, `world_id`, `due_world_time`, `event_family`, `rulepack_version`, `idempotency_key UNIQUE`, `status`, `attempts`, `max_attempts` |
| `narrative_episodes` | `id PK`, `world_id`, `from_seq`, `through_seq`, `world_version`, `narrative_text`, `quality_status`, `generation_run_id`, `created_at` |
| `generation_runs` | `id PK`, `world_id`, `purpose`, `model_id`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_usd`, `validation_status`, `created_at` |
| `organizations` | `id PK`, `world_id`, `org_type`, `status`, `rules_json`; placeholder domain in A |
| `organization_memberships` | `(organization_id,character_id) PK`, `role`, `status`; placeholder domain in A |
| `entitlements` | `user_id`, `plan`, `active_until`, `source`, billing verification; no AI write permission |

### Database invariants
- All world-bound records MUST have a verifiable `world_id` and MUST NOT reference another world's characters, facts, events or organizations.
- Server, not client, determines acting user from authenticated context. Client-provided identity is matched to active membership.
- Event log is append-only for application roles. Corrections are compensating events, never in-place edits.
- Event `world_seq` advances monotonically by one per committed event; `worlds.version` advances by one per successful command batch (not per event). Snapshot records exact committed `worlds.version` and final event sequence.
- Financial/billing data MUST remain in separate access path from simulated world resources.
- A deleted user's personal data must be removed or anonymized in all applicable stores under explicit retention policy; world simulations are not an excuse to retain identifying records.

## 4. Versioned type contracts (TypeScript)

```typescript
export type ID = string; // opaque UUID/ULID; validated by boundary
export type ISOTime = string;
export type WorldMode = 'personal' | 'shared';
export type WorldVisibility = 'private' | 'invite_only' | 'public';
export type WorldStatus = 'creating' | 'active' | 'paused' | 'archived';

export interface World {
  id: ID;
  ownerUserId: ID;
  mode: WorldMode;
  visibility: WorldVisibility;
  status: WorldStatus;
  rulepackId: string;
  rulepackVersion: string;
  blueprintVersion: string;
  stateVersion: number;
  lastEventSequence: number;
  worldTime: ISOTime;
  createdAt: ISOTime;
}

export interface CommandEnvelope<T extends string = string, P = unknown> {
  schemaVersion: '1.0';
  commandId: ID;
  worldId: ID;
  actorIdentityId: ID;
  expectedWorldVersion: number;
  commandType: T;
  payload: P;
}

export interface DomainEvent<T extends string = string, P = unknown> {
  schemaVersion: '1.0';
  eventId: ID;
  worldId: ID;
  sequence: number;
  commandId: ID;
  type: T;
  actorCharacterId: ID | null;
  causedByEventIds: ID[];
  payload: P;
  visibility: 'owner' | 'participants' | 'world';
  worldTime: ISOTime;
  rulesetVersion: string;
}

export interface CommandResult {
  commandId: ID;
  worldId: ID;
  previousVersion: number;
  newVersion: number;
  firstEventSequence: number | null;
  lastEventSequence: number | null;
  outcome: 'committed' | 'no_op';
  eventIds: ID[];
  stateHash: string;
}

export interface NarrativeEpisode {
  id: ID;
  worldId: ID;
  fromEventSequence: number;
  throughEventSequence: number;
  worldStateVersion: number;
  content: string;
  referencedEventIds: ID[];
  allowedChoiceIds: ID[];
  validationStatus: 'passed' | 'rejected' | 'fallback';
}
```

Required command types: `world.create`, `choice.select`, `world.resume`, `surprise.request`, `episode.acknowledge`, `world.pause`, `world.archive`. `world.create` uses a separate creation endpoint and does not require an existing world version. V1 MUST reject unknown command and event types.

Required canonical event types: `world.created`, `world.time_advanced`, `identity.entered_world`, `choice.resolved`, `relationship.changed`, `resource.changed`, `fact.created`, `fact.disclosed`, `story_arc.opened`, `story_arc.progressed`, `story_arc.closed`, `surprise.triggered`, `scheduled_event.resolved`. Additive event schema upgrades require translators/upcasters.

## 5. World-creation contract

**Input:** mode (`create` or `surprise`), optional era/location/identity/style constraints, optional deterministic test seed. Production seeds are randomly assigned server side; user input is sanitized and restricted to supported setting combinations. 

**Pipeline:**
1. Create validated identity (or reuse authorized identity).
2. Select compatible `world_template_id` and `rulepack_version`.
3. Build candidate blueprint (AI may suggest bounded details).
4. Reject contradictory technology/date/setting constraints unless explicit alternative history.
5. Populate 3–5 core NPCs, 2 competing interests, 1 central tension, 2 latent story arcs, 2–4 initial choices (harmonized with Master FR-04 via ADR-012).
6. Validate all foreign keys, resource ranges, graph integrity, role capabilities, content constraints and causal prerequisites.
7. Atomically persist world, membership, blueprint, initial snapshot and `world.created` event.
8. Produce opening episode; failed generation yields templated fallback without affecting canonical state.

**Variation:** Use deterministic `seed` for reproducible tests and controlled pseudo-randomness. Production diversity arises from combination of blueprint, relationship graph, and event eligibility—not merely text paraphrases.

## 6. World state and simulation rules

Canonical `WorldState` v1:
```typescript
interface WorldState {
  schemaVersion: '1.0';
  worldTime: ISOTime;
  characters: Record<ID, {
    status: 'active' | 'unavailable' | 'removed';
    roleIds: string[];
    resources: Record<string, number>;
    goals: string[];
  }>;
  relationships: Record<string, number>; // key = actor|target|dimension; normalized [-100,100]
  flags: Record<string, boolean | string | number>;
  arcStatuses: Record<ID, 'locked' | 'open' | 'resolved' | 'failed'>;
  factualKnowledge: Record<ID, ID[]>; // character -> known fact ids
  futureEventIds: ID[];
}
```

V1 `RulePack` must specify command prerequisites, allowed state transitions, bounded numerical effects, event causes, visibility, cooldowns and time advance behavior. Example: `choice.confront_partner` requires an active partner relationship; changes trust by -12 within [-100,100]; creates a `choice.resolved` and `relationship.changed` event; may open one arc if trust below 40.

**Atomic application:** Validation and transition applied against an immutable working copy. Transaction acquires per-world row lock, checks expected version, writes command result and events, updates world version and snapshot, commits. Rendering takes place *after* commit; AI failure is not a second transition. Repeat commands return the stored result without additional events. Mismatching payload under reused idempotency key returns conflict.

**Concurrency:** Return `409 WORLD_VERSION_CONFLICT` for stale versions with current version; never silently overwrite. B will require world tick scheduling and command ordering, but the same invariant stands.

## 7. World and episode state machines

**World:** `creating -> active <-> paused -> archived`; `creating -> archived` on terminal creation failure. `archived` terminal in v1; no direct jump from `archived` to `active`. Delete is an account data lifecycle operation, not a simulation state.

**Story arc:** `locked -> open -> resolved|failed`. `resolved` and `failed` are terminal; a new arc is a new ID.

**Scheduled event:** `pending -> claimed -> completed`; failures move `claimed -> pending` only with bounded retries and lease expiry, else `failed`. Job handler is idempotent, with outbox/event ledger dedupe.

**Narrative episode:** `pending -> generating -> validated -> published`; on rejection `generating -> retrying -> fallback|failed`; accepted episode always references a committed world version and event interval. On conflict, regenerate against correct version or return explicit retry response. A published episode is immutable; corrections are new episodes/annotations.

## 8. Temporal and surprise engines

Three distinct clocks: `wallTime` (UTC), `worldTime` (canonical), `narrativePosition` (presentation-only). No direct coupling of 1 wall-clock hour to 1 world-hour unless ruleset specifies it. Future world advancement bounded by `maxCatchupTicks` and `maxWorldTimeJump` per resume.

Surprise engine eligibility:
- only allowed when world active, required story dependencies satisfied and cooldown permits;
- valid candidate has a causal hook (existing unresolved arc, character goal, resource change or world setting pressure);
- do not retcon canonical facts; do not disclose facts to characters without a disclosure event;
- enforce per-family diversity cooldown and surprise budget;
- if no valid candidate exists, return `no_op: NO_ELIGIBLE_SURPRISE`, not invented nonsense.

Surprise generation chooses structured event family, parameters and prereqs; validated domain rules commit result before prose generation. Random selection may be seeded for reproducible tests.

## 9. Memory and knowledge boundaries

Memory layers: canonical world facts, event history, per-character knowledge/beliefs, short narrative synopsis and retrieval index. Retrieval indexes are derived projections, never authoritative.

- Each fact MUST have provenance and visibility.
- Characters only learn facts from authorized canonical disclosure events, observed events, or initial biography.
- A character's false belief is stored as a belief; it cannot mutate global truth.
- Narrative generation context is filtered by viewer's permissions and character POV.
- Long-context compaction may compress narrative but MUST NOT silently change world state or facts.
- Prompt injection from users or story text MUST NOT bypass authorization or alter ruleset.

## 10. Narrative AI boundary

Input payload for narration: `world_id`, `committed_version`, `event_ids`, `authorized_pov_facts`, `character_profiles`, `style_constraints`, `allowed_choice_ids`, `prompt_version`, `token_budget`.

Output (strict schema): `episode_text`, `referenced_event_ids`, `choice_copy_by_id`, `content_flags`. AI output is untrusted and subject to schema validation, consistency checks, moderation, and prebuilt fallback copy. It **MUST NOT** introduce new canonical relationships, resources, promises, inaccessible facts or completed actions. Choice IDs come only from simulation, never created by narration.

Generation budget and timeout are checked before provider requests. Unknown provider status or retriable errors must not trigger duplicate canonical actions. Publish episodic prose only after validation against its committed version. Track `input_tokens`, `output_tokens`, `estimated_cost`, `actual_cost_if_known`, latency and validation failures.

## 11. API contract v1

All routes: `/v1`; authenticated with short-lived bearer token except guest-preview. `Idempotency-Key` required for mutations. `X-Request-ID` propagated for tracing. Responses contain `requestId`; failure responses contain stable `code`, `message`, optional `details`.

| Method | Route | Purpose | Core response |
|---|---|---|---|
| `POST` | `/v1/worlds` | Create world from bounded template or Surprise Me genesis | `201 {worldId,version,episodeId?}`; `202` if narration pending |
| `GET` | `/v1/worlds` | List current user's authorized worlds | paginated minimal summaries |
| `GET` | `/v1/worlds/{id}` | Fetch authorized world and current state projection | `{world, stateVersion, summary, choices}` |
| `GET` | `/v1/worlds/{id}/episodes` | Paginated visible episodes | `{items,nextCursor}` |
| `POST` | `/v1/worlds/{id}/choices` | Select a previously offered choice | `{commandResult, episodeStatus, episodeId?}` |
| `POST` | `/v1/worlds/{id}/surprises` | Request bounded surprising event | `{commandResult, episodeStatus, episodeId?}` |
| `POST` | `/v1/worlds/{id}/resume` | Advance eligible catch-up ticks | `{commandResult, episodeStatus}` |
| `GET` | `/v1/worlds/{id}/episodes/{episodeId}` | Poll pending/published episode | `{status,episode?}` |
| `POST` | `/v1/worlds/{id}/pause` | Pause simulation | `{worldId,status,version}` |
| `POST` | `/v1/worlds/{id}/archive` | Archive world | `{worldId,status,version}` |

Mutation body sample:
```json
{
  "schemaVersion": "1.0",
  "commandId": "01JEXAMPLECOMMAND0000000001",
  "expectedWorldVersion": 7,
  "choiceId": "choice_confront_partner"
}
```
Response sample:
```json
{
  "requestId": "req_123",
  "commandResult": {
    "commandId": "01JEXAMPLECOMMAND0000000001",
    "worldId": "world_demo",
    "previousVersion": 7,
    "newVersion": 8,
    "outcome": "committed",
    "eventIds": ["evt_24", "evt_25"],
    "stateHash": "sha256:example"
  },
  "episodeStatus": "pending"
}
```
Standard errors: `400 INVALID_SCHEMA`, `401 UNAUTHENTICATED`, `403 WORLD_ACCESS_DENIED`, `403 WORLD_LIMIT_REACHED` (free-quota handhevet atomar i `world.create`, ADR-012), `404 NOT_FOUND` (do not disclose unauthorized resources), `409 WORLD_VERSION_CONFLICT`, `409 IDEMPOTENCY_PAYLOAD_MISMATCH`, `422 RULE_PRECONDITION_FAILED`, `429 RATE_LIMITED`, `429 WORLD_BUDGET_EXCEEDED`, `503 NARRATIVE_UNAVAILABLE`. Avoid client-supplied `actorUserId`/`worldOwnerId` authorization decisions. `choiceId` must be server-issued, bound to world and version, and unexpired.

## 12. Reference world: The Glass Harbor (fictional Singapore 2034)

**Template ID:** `glass-harbor-2034`; **version:** `1.0`; **genre:** speculative corporate mystery; **mode:** private personal; **age:** adult-oriented but not explicit; **source:** fictional events, not real assertions about named people or companies.

**Opening premise:** You lead Helix Transit, a promising logistics software firm in an alternative Singapore of 2034. Your cofounder Mara Venn quietly receives an acquisition offer from Asterion Holdings. A policy change could undermine your biggest contract, while a whistleblower claims an unknown party influenced the sale process.

**World constraints:** All characters act within ordinary economic and institutional limitations. Money cannot become negative without explicit debt mechanism. Only characters with the relevant facts can cite them. No instant travel. No magic. Technology is speculative but internally bounded. Asterion's hidden connections cannot be public knowledge until disclosed. World currency `CRED` is in-game only, not real money.

**Player identity:** `char_player` / `Alex Vale` (editable name, but fixed reference role), founder/CEO of Helix Transit. Goals: retain control, protect employees, discover offer provenance. Resources: 100 CRED operating cash, 60 influence, 50 public credibility.

**NPCs:**
- `char_mara` Mara Venn — cofounder; wants financial stability; trust(player)=70; knows Asterion offer; doesn't know source of whistleblower claim.
- `char_ilya` Ilya Chen — investor; wants fast exit; trust(player)=45; knows risk to the freight contract.
- `char_noor` Noor Rahman — investigative journalist; wants to verify provenance; trust(player)=35; has partial whistleblower message.
- `char_soren` Soren Pike — Asterion negotiator; wants acquisition; trust(player)=25; knows a concealed connection to prior procurement decision.
- `char_ada` Ada Lin — operations director; wants employee security; trust(player)=65; knows upcoming compliance deadline.

**Starter facts:**
- `fact_offer`: Asterion made an offer to Mara. Visible to player and Mara.
- `fact_contract_risk`: Upcoming contract risk. Visible to player, Ilya and Ada.
- `fact_secret_link`: Soren's undisclosed link to a procurement decision. Initially only Soren knows.
- `fact_whistleblower`: Noor has a partially verified tip. Only Noor initially knows details.

**Starter arcs:**
- `arc_acquisition`: Open. Trigger: offer exists. Closure: accept/reject/counteroffer under rules.
- `arc_hidden_link`: Locked. Trigger: disclosure or qualified investigation. Closure: evidence verified or disproved.
- `arc_staff_security`: Locked. Trigger: public proposal, compliance issue or insolvency risk. Closure: staff protected or unresolved failure.

**Initial snapshot:** `worldVersion=1`, `world_seq=1`, `worldTime=2034-09-15T09:00:00Z`, `cash=100`, `influence=60`, `credibility=50`, trust ranges above, arcs as above. First event `world.created`, with snapshot checksum.

**Allowed opening choices:** `investigate_buyer`, `confront_mara`, `open_negotiation`, `brief_staff`. Every choice has explicit resource costs, relationship effects, eligibility and caused-by references. Numeric deltas below are test fixture rules, not gameplay balancing finalized for production.

### Reference transition rules

| Choice | Preconditions | Immediate effect | Potential arc/event |
|---|---|---|---|
| Investigate buyer | cash >= 10 | cash -10; Noor trust +6 | disclose whistleblower lead; unlock hidden-link arc if evidence threshold met |
| Confront Mara | Mara active | Mara trust -12; credibility +2 | Mara may later share acquisition term sheet if trust >= 50 |
| Open negotiation | influence >= 10 | influence -10; Mara trust +3; Ilya trust +5 | negotiation arc progresses; buyer may demand exclusivity |
| Brief staff | credibility >= 5 | credibility -5; Ada trust +10; Ilya trust -4 | opens staff-security arc |
| Surprise: leaked memo | unresolved acquisition arc; surprise cooldown expired | `surprise.triggered`; Noor obtains a *claim*, not verified fact | opens verification choice without revealing secret-link truth |
| Reject sale | negotiation open, sufficient decision authority | acquisition resolved as rejected | rival alliance may become eligible later |

## 13. Twenty reference scenarios / golden tests

Each scenario MUST assert: requested command and actor permissions, eligibility, exact event type(s), causal references, final version/sequence, resource bounds, visible knowledge, and snapshot replay equivalence. Use deterministic seed and fixed rulepack version. Tests may use more than one command; each case is isolated from clean fixture or explicitly states parent fixture.

| ID | Scenario | Expected assertion |
|---|---|---|
| T01 | Create supported world | Valid blueprint, one owner membership, genesis event, version 1 |
| T02 | Reject incompatible setting | Mars 1888 without alternate-history flag -> validation error; no world created |
| T03 | Investigate buyer | Cash 100->90; disclosure *lead* but not secret factual link |
| T04 | Confront Mara | Trust 70->58, credibility 50->52; causes recorded |
| T05 | Negotiate offer | Influence 60->50, Mara trust 70->73, Ilya 45->50 |
| T06 | Brief staff | Credibility 50->45; Ada trust 65->75; Ilya 45->41; arc opens |
| T07 | Reject action with insufficient resources | Precondition error, version/events unchanged |
| T08 | Replay same idempotency key + same body | Return same result; no duplicate world events |
| T09 | Reuse idempotency key with different payload | `409 IDEMPOTENCY_PAYLOAD_MISMATCH`; no mutation |
| T10 | Two commands at same expected version | Exactly one wins; other gets version conflict |
| T11 | Foreign-world character ID supplied | Reject without leaking information; zero state mutation |
| T12 | Unauthorized account reads private world | 404/403 policy; no sensitive body or episodes |
| T13 | Hidden link known only by Soren | Mara/player/Noor cannot narratively know verified link |
| T14 | Noor gains whistleblower lead through explicit disclosure | Character knowledge updates; canonical link still unverified |
| T15 | Surprise cooldown active | No eligible surprise; no duplicated event |
| T16 | Eligible leak surprise | Surprise committed, causal parent exists, related arc/choice appears |
| T17 | Resume after 48h with catch-up cap | Only bounded ticks; same outcome from seeded replay |
| T18 | Provider narration timeout | Committed state intact; episode retry or fallback; no replayed mutation |
| T19 | State snapshot replay after 20 commands | Recomputed state hash equals stored snapshot |
| T20 | Archive world then attempt choice | Choice rejected; archive terminal; no later mutation |

**Additional stress suites before Beta:** 100 genesis worlds with divergent decisions; 50-episode continuity runs; 1000-command idempotency/concurrency fuzzing; negative security and prompt-injection cases; accessibility and localized text display tests.

## 14. Quantitative acceptance gates

### Required engineering gates
- 100% passing golden fixture tests T01–T20 and all applicable authorization tests.
- Zero critical cross-world data leaks; zero accepted invalid domain transitions in test suite.
- 100% deterministic event replay for fixed seed/rulepack/version, excluding nondeterministic narration text.
- Zero doubled charges or state mutations on replay of identical command.
- 100% valid canonical IDs referenced by published episodes' metadata.
- Narrative failure cannot roll back or duplicate already committed state.
- Strict per-user/provider budget enforcement and recording of measured spend where provided.

### Proposed product validation gates (to be calibrated, not promises)
- D1 returning users >= 40%, D7 >= 20%, D30 >= 10% in a defined cohort.
- At least 3 sessions per active user per week.
- Measured story and choice diversity vs a linear baseline, pre-registered comparison.
- No critical character knowledge leakage in curated 50-episode test runs.
- Retention lift for persistent-world condition vs non-persistent control; require meaningful effect and adequate sample before claims.

## 15. Privacy, security and operational constraints

- Explicit world fiction labeling; no misleading factual prediction of actual futures.
- Default private; do not publish personal-world content without explicit user action.
- Protect sensitive user input; encrypt in transit and at rest; minimum access privileges.
- Moderation at input and output; safe bounded age-appropriate scenario policy. Validate store age requirements before release.
- No impersonation of real individuals without adequate authorization; avoid real sensitive-person biographies.
- Maintain prompt injection isolation: story content is untrusted data, not instructions.
- Rate limits and generation spend caps protect against attacks and runaway bills.
- Data export and deletion flow, retention schedules, and separate handling of derived memories, logs and generated assets.
- Standard operational logs should not contain full private story text by default.
- Observability: command ID, world ID pseudonym, ruleset, generation ID, version, latency, input/output cost, validator reason codes, fallback count, dedupe and conflict rates.

## 16. Delivery backlog, dependency order

**P0 — Canonical Core**: database constraints/migrations; per-world auth/RLS; commands; event ledger; reducer; snapshot/hash/replay; concurrency and idempotency. Gate: T01, T07–T12, T19–T20.

**P1 — Simulation**: validated world templates; identity/character schema; rulepack interpreter; facts, knowledge and relationship effects; narrative choice availability. Gate: T02–T06, T13–T14.

**P2 — Narrative boundary**: prompt contracts, schema validation, generation budget, retry/fallback, publish-from-committed-state. Gate: T18 and consistency suite.

**P3 — Surprise & Time**: candidate eligibility, cooldown, causality proof, catch-up scheduler, idempotent workers. Gate: T15–T17.

**P4 — Alpha mobile**: onboarding, create/surprise, world view, decisions, history, notifications, basic analytics, private beta access.

**P5 — B-readiness validation**: world memberships/roles, visibility-level facts, concurrency conflict simulation, shared-mode schema migration rehearsals; **does not ship multiplayer**.

## 17. Explicit questions deferred, defaults for MVP

- Random generation is seeded and templates have bounded slots rather than unconstrained world genesis.
- Character autonomy is event-driven, not continuously running agents.
- Surprise button is rate-limited with cooldown; no monetized randomized cash rewards.
- Unknown historical claims are fiction by default unless validated by separate historical content pipeline.
- No direct mergers of unrelated private world canons; future shared contexts will fork/branch with explicit consent and provenance.
- Narrative creation and world mutation are separate transactions; all client responses show authoritative version.
- Prices, weekly free quotas, unit budgets and billing SKU IDs require product experiment and are not hard-coded into domain rules.

## 18. Definition of Done for Core Contract implementation

Completion requires: typed schemas and validators; migration files; event reducer; rulepack fixture; command endpoint handlers; database authorization tests; the full twenty-test reference suite; determinism/replay report; representative validated narrative episodes; AI cost telemetry; security negative tests; and a runnable local setup with a README showing how to seed/reference-test the Glass Harbor world.

This document is a design contract, not evidence that anything has been implemented. Any deviation must be recorded in an Architecture Decision Record with migration and test impact.
