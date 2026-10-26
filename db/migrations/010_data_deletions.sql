-- A brand's data deleted on request (db/delete-brand.mjs): the one thing kept afterwards. What kinds of data went and how
-- much (counts by folder, never contents or member names), when, who ran it, the grants the brand was told to revoke itself,
-- and what still holds a copy for a while (backups). A row with done_at NULL is a deletion that did not finish: run it again.
CREATE TABLE data_deletions (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL,
  request    text,                 -- the request it answers (e.g. "hello@ 26 Oct, Delete my data")
  operator   text,
  started_at timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz,
  planned    jsonb NOT NULL,
  removed    jsonb,
  grants     jsonb,
  residual   jsonb,
  came_back  int NOT NULL DEFAULT 0,
  left_after int
);
CREATE INDEX data_deletions_slug ON data_deletions (slug, started_at DESC);
