// A throwaway Postgres for tests: a fresh cluster in a temp folder, on a unix socket, stopped when the process exits.
// PG_TEST_URL uses a server you already run instead. Returns null when no Postgres binaries are on this machine, so the
// pg tests skip rather than fail where Postgres isn't installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const BIN = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/local/opt/postgresql@17/bin'].find((d) => fs.existsSync(path.join(d, 'initdb')));
export function startPg() {
  if (process.env.PG_TEST_URL) return process.env.PG_TEST_URL;
  if (!BIN) return null;
  const dir = fs.mkdtempSync(fs.existsSync('/tmp') ? '/tmp/bpg-' : path.join(os.tmpdir(), 'bpg-')) /* short: a unix socket path is capped near 100 chars */, data = path.join(dir, 'data'), port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' }; /* macOS: without a locale the postmaster refuses to start */
  execFileSync(path.join(BIN, 'initdb'), ['-D', data, '-U', 'brew', '--auth=trust', '-E', 'UTF8', '--no-locale'], { stdio: 'ignore', env });
  execFileSync(path.join(BIN, 'pg_ctl'), ['-D', data, '-l', path.join(dir, 'log'), '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, '-w', 'start'], { stdio: 'ignore', env });
  process.on('exit', () => { spawnSync(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore' }); fs.rmSync(dir, { recursive: true, force: true }); });
  return `postgresql://brew@/postgres?host=${encodeURIComponent(dir)}&port=${port}`;
}
