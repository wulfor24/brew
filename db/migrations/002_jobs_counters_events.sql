-- Phase 2: work that any instance can ask for and exactly one worker does (jobs), the day's spend shared by every
-- instance (counters), and build progress any instance can stream (build_events).
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  queue       text NOT NULL DEFAULT 'batch',          -- 'interactive' (a click waits on it) or 'batch'
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  key         text,                                   -- one open job per key (singleton / idempotency)
  state       text NOT NULL DEFAULT 'queued',         -- queued | running | done | failed
  tries       int NOT NULL DEFAULT 0,
  max_tries   int NOT NULL DEFAULT 3,
  run_at      timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  locked_by   text,
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE UNIQUE INDEX jobs_open_key ON jobs (key) WHERE key IS NOT NULL AND state IN ('queued', 'running');
CREATE INDEX jobs_ready ON jobs (queue, run_at, id) WHERE state = 'queued';
CREATE INDEX jobs_leases ON jobs (locked_until) WHERE state = 'running';
CREATE INDEX jobs_finished ON jobs (done_at) WHERE state IN ('done', 'failed');
CREATE FUNCTION jobs_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.state = 'queued' AND OLD.state IS DISTINCT FROM 'queued') THEN PERFORM pg_notify('jobs_ready', NEW.queue); END IF;
  IF NEW.state IN ('done', 'failed') AND OLD.state IS DISTINCT FROM NEW.state THEN PERFORM pg_notify('jobs_done', NEW.id::text); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER jobs_changed AFTER INSERT OR UPDATE OF state ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_notify();

-- the day's counters (UTC day): AI calls by kind and brand, treg dollars, build dollars
CREATE TABLE counters (
  day   date NOT NULL,
  scope text NOT NULL,
  key   text NOT NULL,
  n     double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope, key)
);

-- a build's progress lines, so a page on any instance can follow a build a worker runs
CREATE TABLE build_events (
  id    bigserial PRIMARY KEY,
  slug  text NOT NULL,
  at    timestamptz NOT NULL DEFAULT now(),
  ev    jsonb NOT NULL
);
CREATE INDEX build_events_slug ON build_events (slug, id);
CREATE FUNCTION build_events_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('build_events', NEW.slug || ' ' || NEW.id::text); RETURN NULL; END $$;
CREATE TRIGGER build_events_added AFTER INSERT ON build_events FOR EACH ROW EXECUTE FUNCTION build_events_notify();
