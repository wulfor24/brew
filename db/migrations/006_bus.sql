-- what one instance tells the others (bus.js): new cards for open workspaces, a connected account read again. Kept a day.
CREATE TABLE bus (
  id      bigserial PRIMARY KEY,
  topic   text NOT NULL,
  payload jsonb NOT NULL,
  by      text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bus_at ON bus (at);
CREATE FUNCTION bus_notify() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('bus', NEW.id::text); RETURN NULL; END $$;
CREATE TRIGGER bus_added AFTER INSERT ON bus FOR EACH ROW EXECUTE FUNCTION bus_notify();
