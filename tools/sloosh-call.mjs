#!/usr/bin/env node
// One Sloosh MCP call from this computer, on the session tools/sloosh-probe.mjs kept (SAVE_SESSION=1 → $OUT/sloosh-session.json).
//   node tools/sloosh-call.mjs list_spaces '{"name":"product","outputType":"image"}'
// The first argument is the tool name; the second is Brew's intent words (argsFor maps them), or raw arguments with RAW=1.
import fs from 'node:fs';
import path from 'node:path';
import { tokenRequest } from '../sloosh-auth.js';
import { createSloosh } from '../sloosh-mcp.js';
const OUT = process.env.OUT || process.env.TMPDIR || '.', FILE = path.join(OUT, 'sloosh-session.json');
let s; try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { console.error(`no session at ${FILE}: run SAVE_SESSION=1 node tools/sloosh-probe.mjs first`); process.exit(2); }
const tokenFor = async ({ force } = {}) => { if (!force && s.exp - Date.now() > 10 * 60e3) return s.token; const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh, client_id: s.client_id }); s = { ...s, ...t }; fs.writeFileSync(FILE, JSON.stringify(s), { mode: 0o600 }); return s.token; };
const S = createSloosh({ tokenFor, log: { warn: (m) => console.error(m) } });
const [name, json] = process.argv.slice(2); if (!name) { console.error('usage: sloosh-call.mjs <tool> [json]'); process.exit(2); }
const args = json ? JSON.parse(json) : {};
const r = process.env.RAW === '1' ? await S.callRaw(name, args) : await S.call(name, args);
console.log(JSON.stringify(r, null, 1));
