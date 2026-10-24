-- Big documents written piece by piece (objects.js PARTED): a brand's moves.json (one part per move) and each workspace
-- (one part per top-level field, and per entry for its big maps). A save writes only the parts that changed, so a move
-- landing rewrites that move, and a workspace saved every 20 s writes only what moved. The objects row stays as the
-- document's stub (content_type application/x-parted) so listings, locks and change notices work as before.
CREATE TABLE doc_parts (
  key  text NOT NULL,
  part text NOT NULL,
  ord  int NOT NULL,
  body bytea NOT NULL,
  PRIMARY KEY (key, part)
);
ALTER TABLE doc_parts ALTER COLUMN body SET COMPRESSION lz4;
