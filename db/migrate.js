// Applies db/migrations/NNN_name.sql in order, each once, inside one transaction per file, under an advisory lock so two
// instances booting together never run the same migration. Run as a step before traffic (tools/promote.sh), or
// `node db/migrate.js`. Migrations are expand/contract only: never break the version still running.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, close } from './index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
export async function migrate({ log = console } = {}) {
  const c = await db().connect();
  try {
    await c.query('SET statement_timeout = 0'); /* a migration (or waiting for another instance's) may take longer than a request */
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const ran = [];
    for (const f of fs.readdirSync(DIR).filter((x) => /^\d{3}_[a-z0-9_]+\.sql$/.test(x)).sort()) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try { await c.query(fs.readFileSync(path.join(DIR, f), 'utf8')); await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]); await c.query('COMMIT'); ran.push(f); log.log(`[migrate] ${f}`); }
      catch (e) { await c.query('ROLLBACK'); throw new Error(`migration ${f}: ${e.message}`); }
    }
    return ran;
  } finally { await c.query('SELECT pg_advisory_unlock(727274)').catch(() => {}); await c.query('RESET statement_timeout').catch(() => {}); c.release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) migrate().then((r) => { console.log(r.length ? `applied ${r.length}` : 'up to date'); return close(); }).catch((e) => { console.error(e.message); process.exit(1); });
