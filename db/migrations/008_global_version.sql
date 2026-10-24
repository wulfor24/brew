-- QV round 2: object versions come from one sequence, so a version is never reused (a delete then a new write once gave
-- version 1 again, and a reader holding the old version 1 would have kept the deleted file)
CREATE SEQUENCE objects_version;
SELECT setval('objects_version', GREATEST(1, (SELECT COALESCE(max(version), 1) FROM objects)));
ALTER TABLE objects ALTER COLUMN version SET DEFAULT nextval('objects_version');
