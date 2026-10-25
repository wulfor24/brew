-- one paid Studio make per board (jam2/make-claim.js): a claim is taken atomically before anything is paid, so two
-- teammates (or two tabs) pressing Make on two instances inside the jam's sync gap can't both pay. A board's claim is held
-- while its make runs and renewed; a press's own key is kept a while, so the same press sent twice runs once.
CREATE TABLE make_claims (
  key   text PRIMARY KEY,
  by    text NOT NULL,
  until timestamptz NOT NULL
);
CREATE INDEX make_claims_until ON make_claims (until);
