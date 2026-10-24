-- QV round 1: an imported row says so (src = 'import'), so a later import can tell a bucket copy the app never touched from
-- one the app rewrote (only the app's own rows get the mirror-lag allowance). Change notices carry the version, so an
-- instance can tell its own write from another instance's.
ALTER TABLE objects ADD COLUMN src text;
CREATE OR REPLACE FUNCTION objects_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('objects', COALESCE(NEW.key, OLD.key) || '|' || COALESCE(NEW.version, 0)::text); RETURN NULL; END $$;
