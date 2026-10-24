-- Phase 3: sign-ins that can be ended (sessions, sign out everywhere) and who opened which brand (access_log).
CREATE TABLE sessions (
  sid        text PRIMARY KEY,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ua         text,
  ip         text
);
CREATE INDEX sessions_email ON sessions (email);
CREATE INDEX sessions_revoked ON sessions (revoked_at) WHERE revoked_at IS NOT NULL;
-- "sign out everywhere": every session of the email issued before `before` ends
CREATE TABLE session_revocations (email text PRIMARY KEY, before timestamptz NOT NULL);
CREATE FUNCTION sessions_notify() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('sessions_revoked', ''); RETURN NULL; END $$;
CREATE TRIGGER sessions_revoked AFTER UPDATE OF revoked_at ON sessions FOR EACH ROW WHEN (NEW.revoked_at IS NOT NULL) EXECUTE FUNCTION sessions_notify();
CREATE TRIGGER session_revocations_changed AFTER INSERT OR UPDATE ON session_revocations FOR EACH ROW EXECUTE FUNCTION sessions_notify();

CREATE TABLE access_log (
  slug    text NOT NULL,
  email   text NOT NULL,
  first   timestamptz NOT NULL DEFAULT now(),
  last    timestamptz NOT NULL DEFAULT now(),
  n       int NOT NULL DEFAULT 0,
  name    text,
  access  text NOT NULL,          -- brew | team | official | blocked
  blocked int NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, email)
);
CREATE INDEX access_log_last ON access_log (last DESC);
