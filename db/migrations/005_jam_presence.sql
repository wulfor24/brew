-- who has a jam open (presence.js): rebuilt from heartbeats every few seconds, so unlogged (not kept through a crash)
CREATE UNLOGGED TABLE jam_presence (
  wid    text NOT NULL,
  email  text NOT NULL,
  name   text,
  pic    text,
  typing boolean NOT NULL DEFAULT false,
  at     timestamptz NOT NULL,
  PRIMARY KEY (wid, email)
);
CREATE INDEX jam_presence_at ON jam_presence (at);
