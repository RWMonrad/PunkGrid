-- 007 — schedulers, entitlements, organization placeholders and the audit post
-- Contract sections 3, 7 and 8, plus the retention decision in ADR-014.

SET search_path = punkgrid, public;

-- Due jobs advance the world clock on resume. Bounded retries and lease expiry
-- keep a handler idempotent (section 7); the ledger dedupes by idempotency_key.
CREATE TABLE scheduled_events (
  id              TEXT PRIMARY KEY,
  world_id        TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  due_world_time  TIMESTAMPTZ NOT NULL,
  event_family    TEXT NOT NULL,
  rulepack_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          scheduled_status NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_until     TIMESTAMPTZ,
  -- a claimed row must carry a lease, so a crashed worker cannot strand it
  CONSTRAINT claim_needs_lease CHECK (status <> 'claimed' OR lease_until IS NOT NULL),
  CONSTRAINT retries_bounded CHECK (attempts <= max_attempts)
);
CREATE INDEX scheduled_due_idx ON scheduled_events(world_id, status, due_world_time);

-- Billing lives in a separate access path from simulated world resources
-- (section 3), and no AI role is ever granted write access here.
CREATE TABLE entitlements (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan          entitlement_plan NOT NULL,
  active_until  TIMESTAMPTZ,
  source        TEXT NOT NULL CHECK (source IN ('platform_iap', 'manual_grant', 'promotion')),
  max_active_worlds INTEGER NOT NULL CHECK (max_active_worlds > 0),
  verified_at   TIMESTAMPTZ
);

-- Placeholder domain for version B (section 3). Present so the schema does not
-- need a breaking change later; nothing in v1 writes these rows.
CREATE TABLE organizations (
  id        TEXT PRIMARY KEY,
  world_id  TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  org_type  TEXT NOT NULL,
  status    TEXT NOT NULL,
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  world_id        TEXT NOT NULL,
  character_id    TEXT NOT NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL,
  PRIMARY KEY (organization_id, character_id),
  FOREIGN KEY (world_id, character_id) REFERENCES characters(world_id, id)
);

-- ADR-014: after a user-initiated deletion this is the only surviving record,
-- and it holds no narrative text, no NPC data and no billing detail.
CREATE TABLE deletion_audit (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  world_id      TEXT NOT NULL,          -- pseudonymous reference only
  action        TEXT NOT NULL CHECK (action IN ('export', 'deletion_requested', 'deletion_completed')),
  outcome_code  TEXT NOT NULL,
  performed_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX deletion_audit_account_idx ON deletion_audit(account_id, performed_at);

-- Telemetry required by section 15 and ADR-013, deliberately free of story
-- text: command id, pseudonymous world id, version, latency and cost.
CREATE TABLE operation_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    TEXT NOT NULL,
  command_id    TEXT,
  world_pseudonym TEXT,
  world_version BIGINT,
  rulepack_version TEXT,
  generation_run_id TEXT,
  operation     TEXT NOT NULL,
  reason_code   TEXT,
  latency_ms    INTEGER,
  cost_usd      NUMERIC(10, 6),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX operation_log_time_idx ON operation_log(recorded_at DESC);
