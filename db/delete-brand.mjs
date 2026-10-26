// Delete all of one brand's data for a data request ("Delete my data", 7 days), on a site that keeps its data in Postgres
// (STORAGE=pg). Dry run by default: prints exactly what would go. Run as the brew-ops job (staging) or brew-prod-ops (production):
//   --args=db/delete-brand.mjs,--slug,<slug>                                         dry run
//   --args=db/delete-brand.mjs,--slug,<slug>,--yes,--request,<ref>,--operator,<name>  delete (staging also needs --rev-n,<n>)
// Removes every row under brands/<slug>/ (our stored tokens and connections too), its workspaces, its archived copies in
// _deleted/, build progress, jobs, bus messages, counters, access log rows, the bucket files (every version) and the made and
// research media only this brand points at. Keeps nothing but one data_deletions row (010_data_deletions.sql): counts by
// folder, when, who, the grants, and what backups still hold for a while.
// Never calls a platform: no grant is revoked or disconnected. It prints which grants the brand must revoke itself.
// Refuses the five design partners unless --partner-override --confirm-slug <slug>; refuses a PROTECTED_CONNECTIONS brand always.
import { main } from './wipe-cli.js';
process.exitCode = await main('delete');
