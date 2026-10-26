// Reset one brand to a fresh first run on a site that keeps its data in Postgres (STORAGE=pg), keeping every connection.
// Dry run by default: prints exactly what would go. Run as the brew-ops Cloud Run job (the database has a private IP only):
//   --args=db/reset-brand.mjs,--slug,<slug>                     dry run
//   --args=db/reset-brand.mjs,--slug,<slug>,--rev-n,<n>,--yes   reset (n: the live revision, as for db/reset-jams.mjs)
// Removes: rows under brands/<slug>/ (read, moves, members, jams, drafts…), the brand's workspaces, build progress, queued
// and finished jobs, bus messages, and the brand folder's bucket files. A copy goes to _deleted/brand-<slug>-<time>/
// (not on production; --no-archive for none).
// Never touched: private/connections.json, private/vault/*, live/*, private/live/*, private/live-base.json,
// private/connected-ledger.json (db/brand-wipe.js KEEP; the run verifies they are byte for byte the same afterwards).
// Refuses the five design partners unless --partner-override --confirm-slug <slug>.
// Replaces tools/reset-brand.sh (bucket era).
import { main } from './wipe-cli.js';
process.exitCode = await main('reset');
