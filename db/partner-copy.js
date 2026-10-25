// Phase 6: a design partner's brand copied from staging (brew.joinsquareup.com) to production (feed.joinsquareup.com), as
// it is, without connecting anything again. Read-only on staging; on production it writes only what the copy owns.
// - Rows: every structured file under brands/<slug>/ from staging's database (parted documents with their parts), minus what
//   is our testing or staging's own (SKIP). A row production already changed itself (src is not 'migrate') is never
//   overwritten, so the copy can run again after the switch (a final delta) and production stays the truth.
// - Sign-ins (private/vault/*): decrypted with staging's key and encrypted with production's, in this process. Nothing is
//   refreshed, revoked or re-selected: the same tokens work from both sites (Arata: Shopify's never expires, Meta's never
//   refreshes), so Arata stays connected on both.
// - Files: the brand's pictures, PDFs and statics (bucket to bucket, server-side), and the shared research media and generated
//   images its rows point at (research/<hash>, gen/<name>).
// - Workspaces are not copied: every partner workspace today is staff testing or anonymous (25 Oct); people start fresh.
import crypto from 'node:crypto';
import { isRow, joinDoc } from '../objects.js';
import { decryptWith, encryptWith } from '../vault.js';

const STUB = 'application/x-parted';
/* a connection staff tested with a simulated account (sim), and the ledger rows it wrote (demo), stay on staging */
const SIM_FILES = /^private\/(connections|connected-ledger)\.json$/;
export function stripSim(body) {
  let j; try { j = JSON.parse(body.toString('utf8')); } catch { return null; }
  let n = 0; const fake = (x) => x && typeof x === 'object' && (x.sim === true || x.demo === true);
  const walk = (v) => { if (Array.isArray(v)) return v.filter((x) => (fake(x) ? (n++, false) : true)).map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => (fake(x) ? (n++, false) : true)).map(([k, x]) => [k, walk(x)]));
    return v; };
  const out = walk(j); return n ? { body: Buffer.from(JSON.stringify(out)), n } : null;
}
/* rel path inside brands/<slug>/ → why it stays on staging */
export const SKIP = [
  [/^raw\//, 'raw paid answers (only the same day is read back)'],
  [/^private\/backup-/, 'a staging backup'],
  [/^(private\/)?jams(-v2)?\.json$/, 'jams made while testing'],
  [/^private\/finals\//, 'finals of those jams'],
  [/^private\/sloosh-assets\.json$/, 'Sloosh uploads of staging links'],
  [/^start-lock\.json$/, "staging's build lock"],
  [/^spend\//, "staging's spend"],
  [/^private\/vault\/[^/]*-pending-/, 'a sign-in never finished'],
  [/^demo(\/|\.json$)/, 'a demo sandbox']
];
export const skipWhy = (rel) => (SKIP.find(([re]) => re.test(rel)) || [])[1] || null;
/* shared rows that are not testing and save production paid calls: confirmed holidays, video reads of viral clips */
export const GLOBAL = /^brands\/_brew\/(calendar\/confirmed\.json|video\/[^/]+\.json)$/;
/* the partners this copy is for (25 Oct); anything else needs --any, and a test brand never goes */
export const PARTNERS = ['scrubroom-in', 'manaprojects-com', 'nutrova-com', 'in-puma-com', 'arata-in'];
export const TEST_BRANDS = /^(cozysnugglet-shop|zenant-club.*|adpage.*|questions|zz-.*)$/;

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const partsSig = (parts) => md5(Buffer.concat(parts.slice().sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0)).flatMap((p) => [Buffer.from(`${p.part}\u0000${p.ord}\u0000`), p.body, Buffer.from('\u0001')])));
/* what a row means, to compare a staging row with production's copy: a vault row by its plain secret (the ciphertext is new each time) */
const vaultPlain = (body, key) => { const x = JSON.parse(body.toString('utf8')); return JSON.stringify({ s: x.c ? decryptWith(key, x.c) : null, at: x.at || null }); };
/* the files rows point at: research media (research/<20 hex>.ext) and generated images (gen/<name>) */
/* every extension gen-store.js serves (a carousel's zip, a voiceover's wav, a team brief's pdf, a film's srt and gif); a voiceover is
   kept as a bare name ("<hash>.wav"), so a whole string value shaped like a generated file is a maybe: copied when staging has it */
const GEN_EXT = 'png|jpe?g|webp|wav|mp4|zip|pdf|srt|gif';
export function mediaRefs(text, out = { research: new Set(), gen: new Set(), maybe: new Set() }) {
  out.maybe ||= new Set();
  for (const m of String(text).matchAll(/(?:^|[^A-Za-z0-9_])research\/([a-f0-9]{20}\.(?:jpg|png|mp4))/g)) out.research.add(m[1]);
  for (const m of String(text).matchAll(new RegExp(`(?:^|[^A-Za-z0-9_-])gen\\/([A-Za-z0-9._-]+\\.(?:${GEN_EXT}))`, 'g'))) out.gen.add(m[1]);
  for (const m of String(text).matchAll(new RegExp(`"([a-z0-9_-]{6,64}\\.(?:wav|mp4|zip|pdf|srt|gif))"`, 'gi'))) if (!out.gen.has(m[1])) out.maybe.add(m[1]);
  return out;
}

/* src, dst: pg pools (staging, production). keys: { src, dst } vault keys. store: buckets (see gcsStore). apply false = a dry run */
export async function copyBrand({ src, dst, slug, keys, store, apply = false, log = console }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug === '_brew') throw new Error(`not a brand: ${slug}`);
  if (TEST_BRANDS.test(slug)) throw new Error(`${slug} is a test brand: it never goes to production`);
  const prefix = `brands/${slug}/`, r = { slug, rows: 0, parts: 0, copied: 0, same: 0, keptProd: 0, vault: [], skipped: {}, files: 0, filesCopied: 0, media: 0, mediaCopied: 0, mediaMissing: [], bytes: 0 };
  const rows = (await src.query(`SELECT key, body, content_type, updated_at FROM objects WHERE starts_with(key, $1) ORDER BY key`, [prefix])).rows;
  if (!rows.some((x) => x.key === `${prefix}status.json`)) throw new Error(`${slug}: no status.json on staging, not a built brand`);
  const refs = { research: new Set(), gen: new Set(), maybe: new Set() }, plan = [];
  for (const row of rows) {
    const rel = row.key.slice(prefix.length), why = skipWhy(rel);
    if (why) { r.skipped[why] = (r.skipped[why] || 0) + 1; continue; }
    if (row.content_type === STUB) {
      const parts = (await src.query('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [row.key])).rows;
      plan.push({ ...row, parts }); mediaRefs(joinDocText(parts), refs);
    } else if (row.body?.length) {
      if (/^private\/vault\//.test(rel)) { const x = JSON.parse(row.body.toString('utf8')); if (!x.c) { r.skipped['an empty sign-in'] = (r.skipped['an empty sign-in'] || 0) + 1; continue; }
        const plain = decryptWith(keys.src, x.c); /* throws on a wrong key: nothing is written with a secret that can't be read */
        let kinds; try { kinds = Object.keys(JSON.parse(plain)).join(','); } catch { throw new Error(`${row.key}: the sign-in is not readable JSON`); } /* never the text itself */
        r.vault.push({ file: rel.slice('private/vault/'.length), kinds, at: new Date(x.at || 0).toISOString() });
        plan.push({ ...row, vault: { at: x.at || Date.now(), plain } }); }
      else { const clean = SIM_FILES.test(rel) ? stripSim(row.body) : null; /* simulated connector data from staff testing never goes */
        if (clean) r.simStripped = (r.simStripped || 0) + clean.n;
        plan.push(clean ? { ...row, body: clean.body } : row); mediaRefs(row.body.toString('utf8'), refs); }
    } /* an empty body is a row locked for a first write that never came: nothing to copy */
  }
  r.rows = plan.length; r.parts = plan.reduce((n, x) => n + (x.parts?.length || 0), 0);
  for (const x of plan) {
    const cur = (await dst.query('SELECT body, content_type, src FROM objects WHERE key = $1', [x.key])).rows[0];
    if (cur && cur.src !== 'migrate') { r.keptProd++; continue; } /* production wrote it after the copy: it is the truth now */
    if (cur && await sameAs(dst, x, cur, keys)) { r.same++; continue; }
    r.copied++; r.bytes += x.parts ? x.parts.reduce((n, p) => n + p.body.length, 0) : x.body.length;
    if (!apply) continue;
    await tx(dst, async (c) => {
      if (x.parts) {
        const w = await c.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, '\\x', '${STUB}', $2, 'migrate')
          ON CONFLICT (key) DO UPDATE SET body = '\\x', content_type = '${STUB}', updated_at = EXCLUDED.updated_at, src = 'migrate', version = nextval('objects_version') WHERE objects.src = 'migrate'`, [x.key, x.updated_at]);
        if (!w.rowCount) return; /* production wrote it meanwhile */
        await c.query('DELETE FROM doc_parts WHERE key = $1', [x.key]);
        for (const p of x.parts) await c.query('INSERT INTO doc_parts (key, part, ord, body) VALUES ($1, $2, $3, $4)', [x.key, p.part, p.ord, p.body]);
      } else {
        const body = x.vault ? Buffer.from(JSON.stringify({ c: encryptWith(keys.dst, x.vault.plain), at: x.vault.at })) : x.body;
        const w = await c.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, $2, $3, $4, 'migrate')
          ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, updated_at = EXCLUDED.updated_at, src = 'migrate', version = nextval('objects_version') WHERE objects.src = 'migrate'`, [x.key, body, x.content_type, x.updated_at]);
        if (w.rowCount) await c.query('DELETE FROM doc_parts WHERE key = $1', [x.key]); /* only parts of the copy's own earlier version */
      }
    });
  }
  /* the brand's own files (pictures, PDFs, statics): every non-row object outside the skipped folders */
  const files = (await store.list(store.src, prefix)).filter((f) => !isRow(f.name) && !skipWhy(f.name.slice(prefix.length)));
  const have = new Map((await store.list(store.dst, prefix)).map((f) => [f.name, f.md5]));
  r.files = files.length;
  for (const f of files) { if (have.get(f.name) === f.md5) continue; r.filesCopied++; r.bytes += +f.size || 0; if (apply) await store.copy(store.src, f.name, store.dst, f.name); }
  /* shared media the copied rows point at */
  const want = [...[...refs.research].map((n) => ({ to: `research-media/${n}`, from: [`research-media/${n}`, `media/${n}`] })), ...[...refs.gen].map((n) => ({ to: `gen/${n}`, from: [`gen/${n}`] })),
    ...[...refs.maybe].filter((n) => !refs.gen.has(n)).map((n) => ({ to: `gen/${n}`, from: [`gen/${n}`], maybe: true }))];
  r.media = want.filter((m) => !m.maybe).length;
  for (const m of want) {
    if (await store.exists(store.dst, m.to)) continue;
    let from = null; for (const k of m.from) if (await store.exists(store.src, k)) { from = k; break; }
    if (!from) { if (!m.maybe) r.mediaMissing.push(m.to); continue; } /* already missing on staging: the card shows what it shows there (a maybe was only a name) */
    r.mediaCopied++; if (apply) await store.copy(store.src, from, store.dst, m.to);
  }
  log.log?.(`[partner] ${slug} ${apply ? 'copied' : 'dry run'}: ${JSON.stringify({ ...r, mediaMissing: r.mediaMissing.length })}`);
  return r;
}
const joinDocText = (parts) => { try { return JSON.stringify(joinDoc(parts)); } catch { return parts.map((p) => p.body.toString('utf8')).join('\n'); } };
async function sameAs(dst, x, cur, keys) {
  if (x.parts) { if (cur.content_type !== STUB) return false; return partsSig((await dst.query('SELECT part, ord, body FROM doc_parts WHERE key = $1', [x.key])).rows) === partsSig(x.parts); }
  if (cur.content_type === STUB) return false;
  if (x.vault) { try { return vaultPlain(cur.body, keys.dst) === JSON.stringify({ s: x.vault.plain, at: x.vault.at }); } catch { return false; } }
  return cur.content_type === x.content_type && md5(cur.body) === md5(x.body);
}
async function tx(pool, fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } }

/* the shared rows (GLOBAL): same rules as a brand's (production's own changes are kept) */
export async function copyGlobal({ src, dst, apply = false, log = console }) {
  const rows = (await src.query(`SELECT key, body, content_type, updated_at FROM objects WHERE starts_with(key, 'brands/_brew/') AND content_type <> '${STUB}' ORDER BY key`)).rows.filter((x) => GLOBAL.test(x.key) && x.body?.length);
  const r = { rows: rows.length, copied: 0, same: 0, keptProd: 0 };
  for (const x of rows) {
    const cur = (await dst.query('SELECT body, src FROM objects WHERE key = $1', [x.key])).rows[0];
    if (cur && cur.src !== 'migrate') { r.keptProd++; continue; }
    if (cur && md5(cur.body) === md5(x.body)) { r.same++; continue; }
    r.copied++; if (!apply) continue;
    await dst.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, $2, $3, $4, 'migrate')
      ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, content_type = EXCLUDED.content_type, updated_at = EXCLUDED.updated_at, src = 'migrate', version = nextval('objects_version') WHERE objects.src = 'migrate'`, [x.key, x.body, x.content_type, x.updated_at]);
  }
  log.log?.(`[partner] shared rows ${apply ? 'copied' : 'dry run'}: ${JSON.stringify(r)}`);
  return r;
}

/* the two buckets through the JSON API: list (name, md5, size), exists, and a server-side copy (rewrite, so nothing is downloaded) */
export function gcsStore({ src, dst, token }) {
  const enc = encodeURIComponent, H = async () => ({ authorization: `Bearer ${await token()}` });
  const call = async (url, init = {}) => { for (let i = 0; ; i++) { const r = await fetch(url, { ...init, headers: { ...(await H()), ...(init.headers || {}) }, signal: AbortSignal.timeout(120e3) }); if (r.ok || r.status === 404 || i >= 4 || (r.status < 500 && r.status !== 429)) return r; await new Promise((s) => setTimeout(s, 500 * 2 ** i)); } };
  return { src, dst,
    async list(bucket, prefix) { const out = []; let pt = ''; do { const r = await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${enc(prefix)}&fields=items(name,md5Hash,size),nextPageToken${pt ? '&pageToken=' + enc(pt) : ''}`); if (!r.ok) throw new Error(`list ${bucket}/${prefix} ${r.status}`); const j = await r.json(); for (const x of j.items || []) out.push({ name: x.name, md5: x.md5Hash || null, size: +x.size || 0 }); pt = j.nextPageToken || ''; } while (pt); return out; },
    async exists(bucket, name) { const r = await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${enc(name)}?fields=name`); if (r.status === 404) return false; if (!r.ok) throw new Error(`stat ${bucket}/${name} ${r.status}`); return true; },
    async copy(fromB, from, toB, to) { let rt = ''; do { const r = await call(`https://storage.googleapis.com/storage/v1/b/${fromB}/o/${enc(from)}/rewriteTo/b/${toB}/o/${enc(to)}${rt ? '?rewriteToken=' + enc(rt) : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error(`copy ${from} → ${toB}/${to} ${r.status}`); const j = await r.json(); rt = j.done ? '' : j.rewriteToken; } while (rt); } };
}
