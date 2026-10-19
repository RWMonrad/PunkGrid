-- 010 — shared rate-limit buckets (docs/qa/SECURITY.md F-S6)
--
-- The in-process bucket in core/src/server/rateLimit.ts is per instance: with N
-- API instances behind a load balancer, one account spends its allowance N times
-- over, and the anonymous address bucket is keyed on the balancer's own address
-- and therefore shared by every customer. This table holds one bucket per key so
-- all instances spend from the same allowance.
--
-- Two decisions carry the design:
--
-- * The clock is the database's. Every timestamp here is statement_timestamp(),
--   read once per call into a variable, so instances whose clocks disagree by a
--   minute still agree about how much a bucket has refilled. Passing elapsed time
--   in from JavaScript would reintroduce exactly the disagreement this table
--   exists to remove.
--
-- * This is the only table the request path writes. 008 deliberately gives
--   punkgrid_app no INSERT/UPDATE on the canonical tables, because a handler bug
--   must not turn SQL into a state mutation path. Rate-limit state is not
--   canonical: it names no world, holds no narrative, and losing every row costs a
--   minute of allowance rather than data. Row-level security is therefore off here
--   — there is no world to be a member of — and the grants at the bottom are the
--   whole boundary.

SET search_path = punkgrid, public;

-- 008's `GRANT ... ON ALL TABLES` covers the tables that existed when it ran, so
-- each later migration states its own grants instead of relying on that one.
CREATE TABLE rate_limit_bucket (
  bucket_key         TEXT PRIMARY KEY,
  -- The policy the most recent caller applied. A deployment has one policy for all
  -- of its instances, so restating it on every take heals a config change; two
  -- instances that disagree overwrite each other's rate, which is a
  -- misconfiguration to fix rather than state to preserve.
  capacity           NUMERIC NOT NULL CHECK (capacity > 0),
  refill_per_minute  NUMERIC NOT NULL CHECK (refill_per_minute > 0),
  tokens             NUMERIC NOT NULL CHECK (tokens >= 0),
  updated_at         TIMESTAMPTZ NOT NULL,
  -- Re-stating a smaller capacity must not leave a fuller bucket behind, or a
  -- shrunken allowance stays spendable.
  CONSTRAINT bucket_never_exceeds_capacity CHECK (tokens <= capacity)
);

-- One take per call. The row lock is what makes it atomic: a second instance
-- calling the same key blocks in the SELECT, and then recomputes from the value
-- the first one wrote rather than from the snapshot it read.
CREATE FUNCTION punkgrid_rate_limit_take(p_key TEXT, p_capacity NUMERIC, p_refill_per_minute NUMERIC)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SET search_path = punkgrid, public
AS $$
DECLARE
  taken_at TIMESTAMPTZ := statement_timestamp();
  had      NUMERIC;
  had_at   TIMESTAMPTZ;
  refilled NUMERIC;
BEGIN
  -- A policy of zero would break the CHECKs above; a deployment typo should say
  -- so here rather than fail inside an insert on the request path.
  IF p_capacity <= 0 OR p_refill_per_minute <= 0 THEN
    RAISE exception 'rate limit policy must be positive (capacity %, refill_per_minute %)',
      p_capacity, p_refill_per_minute;
  END IF;

  -- First sight of a key: a full bucket, spent below. Inserting rather than
  -- upserting keeps the read-modify-write down one path.
  INSERT INTO punkgrid.rate_limit_bucket (bucket_key, capacity, refill_per_minute, tokens, updated_at)
  VALUES (p_key, p_capacity, p_refill_per_minute, p_capacity, taken_at)
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT b.tokens, b.updated_at INTO had, had_at
  FROM punkgrid.rate_limit_bucket b
  WHERE b.bucket_key = p_key
  FOR UPDATE;

  -- greatest(0, ...) keeps a hand-edited future timestamp from pushing tokens
  -- under their own CHECK. The refill rate is the caller's, not the row's: the
  -- UPDATE below writes the same policy it computed with, so the two never
  -- disagree inside one call.
  refilled := least(
    p_capacity,
    had + greatest(0, extract(epoch from (taken_at - had_at))) * (p_refill_per_minute / 60.0)
  );

  UPDATE punkgrid.rate_limit_bucket
     SET capacity          = p_capacity,
         refill_per_minute = p_refill_per_minute,
         -- A denial spends nothing: the bucket keeps the level this call just
         -- recomputed, so the retry-after it handed back stays true for the next
         -- request as well.
         tokens            = CASE WHEN refilled >= 1 THEN refilled - 1 ELSE refilled END,
         updated_at        = taken_at
   WHERE bucket_key = p_key;

  IF refilled >= 1 THEN
    RETURN QUERY SELECT true, floor(refilled - 1)::integer, 0;
  END IF;
  -- The same arithmetic as TokenBucket.tryTake: seconds until one more token.
  -- refilled is below one here, so its floored `remaining` is zero by definition.
  RETURN QUERY SELECT false, 0,
    greatest(1, ceil((1 - refilled) * 60.0 / p_refill_per_minute))::integer;
END
$$;

-- Only the request path spends a bucket; the narration worker has no reason to
-- touch one. The function runs with invoker rights (no SECURITY DEFINER, unlike
-- 008's membership check, which is a deliberate privilege route), so a role
-- without these grants cannot drain a bucket even though it may execute the
-- function.
GRANT SELECT, INSERT, UPDATE ON punkgrid.rate_limit_bucket TO punkgrid_app;
GRANT ALL ON punkgrid.rate_limit_bucket TO punkgrid_owner;
