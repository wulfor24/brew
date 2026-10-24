-- Step 1 of the move off the bucket: every structured object the app kept as a JSON/text file in GCS
-- (tenants/, brands/<slug>/…, _brew/…, _cache/…, control/…) is one row, same key as its old object name.
-- Pictures, video, PDFs and zips stay in the bucket. Later migrations move hot data into real tables.
CREATE TABLE objects (
  key          text PRIMARY KEY,
  body         bytea NOT NULL,
  content_type text NOT NULL DEFAULT 'application/json',
  version      bigint NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE objects ALTER COLUMN body SET COMPRESSION lz4;
-- prefix listings (a brand's files, a folder, every tenant) walk the primary key in order
CREATE INDEX objects_key_prefix ON objects (key text_pattern_ops);
-- every write tells the other instances which object changed (cache drops)
CREATE FUNCTION objects_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('objects', COALESCE(NEW.key, OLD.key)); RETURN NULL; END $$;
CREATE TRIGGER objects_changed AFTER INSERT OR UPDATE OR DELETE ON objects FOR EACH ROW EXECUTE FUNCTION objects_notify();
