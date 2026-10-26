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
// Three plain words for the go-live swap (docs/go-live-swap.md section 4):
// - jams: the jams (jams.json, jams-v2.json) and their finals come too, with the media they point at.
// - sync: staging wins for brand content. Connection rows (vault, connections, ledger, live) are never overwritten; members are
//   unioned by email; parted documents merge part by part and keep the parts only production has; everything else is replaced.
//   The production rows it replaces are exported first (exportRows); every write is guarded by the version it read.
// - workspaces (copyWorkspaces): a partner's workspaces (tenants/t_*.json), only where production has none with that key.
// A protected brand (PROTECTED_CONNECTIONS, default arata-in) never has a connection row written, in any mode: if one is missing
// on production the copy STOPs before writing anything (it is never "fixed" by copying a sign-in over).
import crypto from 'node:crypto';
import { isRow, joinDoc, splitDoc } from '../objects.js';
import { decryptWith, encryptWith } from '../vault.js';
import { PROTECTED } from '../connectors/protected.js';

const STUB = 'application/x-parted', SEP = '\u0001';
const ALWAYS = /(^|\/)private\/jams(-v2)?\.json$/; /* objects.js: a jams document is always split per jam */
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
const JAMS_WHY = 'jams made while testing', FINALS_WHY = 'finals of those jams';
export const SKIP = [
  [/^raw\//, 'raw paid answers (only the same day is read back)'],
  [/^private\/backup-/, 'a staging backup'],
  [/^(private\/)?jams(-v2)?\.json$/, JAMS_WHY],
  [/^private\/finals(-beat)?\//, FINALS_WHY],
  [/^private\/sloosh-assets\.json$/, 'Sloosh uploads of staging links'],
  [/^start-lock\.json$/, "staging's build lock"],
  [/^spend\//, "staging's spend"],
  [/^private\/vault\/[^/]*-pending-/, 'a sign-in never finished'],
  [/^demo(\/|\.json$)/, 'a demo sandbox']
];
/* jams: true lets the jams and their finals through; everything else in SKIP stays on staging */
export const skipWhy = (rel, { jams = false } = {}) => (SKIP.find(([re, why]) => re.test(rel) && !(jams && (why === JAMS_WHY || why === FINALS_WHY))) || [])[1] || null;
/* a brand's connections: never overwritten by sync, never written at all for a protected brand */
export const CONNECTION = /^(private\/vault\/|private\/connections\.json$|private\/connected-ledger\.json$|live\/|private\/live\/|private\/live-base\.json$)/;
const MEMBERS = /^private\/members\.json$/;
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

/* sync, parted documents: staging's parts replace parts of the same name; parts only production has are kept (after staging's,
   in production's order) unless staging keeps that field whole or split another way, where they can't sit (dropped, and said) */
export function mergeParts(stg, prd) {
  const names = new Set(stg.map((p) => p.part)), top = (p) => { const i = p.indexOf(SEP); return i < 0 ? p : p.slice(0, i); };
  const kindOf = (p) => { const i = p.indexOf(SEP); return i < 0 ? null : p[i + 1]; };
  const head = new Map();
  for (const p of stg) if (p.part.indexOf(SEP) < 0) { let k = null; try { const v = JSON.parse(p.body.toString('utf8')); if (v && typeof v === 'object' && !Array.isArray(v) && v.__split && Object.keys(v).length === 1) k = v.__split; } catch {} head.set(p.part, k); }
  const stgTops = new Set(stg.map((p) => top(p.part))), kept = [], dropped = [];
  for (const p of prd.slice().sort((a, b) => a.ord - b.ord || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0))) {
    if (names.has(p.part)) continue;
    const t = top(p.part);
    if (!stgTops.has(t)) kept.push(p); /* a field only production has */
    else if (kindOf(p.part) && head.get(t) && head.get(t) === kindOf(p.part)) kept.push(p); /* an entry (a jam a partner started there) of a field both split the same way */
    else dropped.push(p.part);
  }
  const base = stg.reduce((n, p) => Math.max(n, p.ord), -1) + 1;
  return { parts: [...stg.map((p) => ({ part: p.part, ord: p.ord, body: p.body })), ...kept.map((p, i) => ({ part: p.part, ord: base + i, body: p.body }))], kept: kept.map((p) => p.part), dropped };
}
/* sync, members.json: everyone on either side, by email. Same email: staging's entry unless production's is newer (at). */
export function unionMembers(stgBody, prdBody) {
  const j = (b) => { try { const v = JSON.parse(b.toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const s = j(stgBody), p = j(prdBody), onlyProd = [];
  const merge = (a, b, note) => { const out = new Map(); for (const x of a || []) if (x?.email) out.set(String(x.email).toLowerCase(), x);
    for (const x of b || []) { if (!x?.email) continue; const e = String(x.email).toLowerCase(), y = out.get(e); if (!y) { out.set(e, x); if (note) onlyProd.push(e); } else if ((+x.at || 0) > (+y.at || 0)) out.set(e, x); }
    return [...out.values()]; };
  const members = merge(s.members, p.members, true), inMembers = new Set(members.map((x) => String(x.email).toLowerCase()));
  const invites = merge(s.invites, p.invites, false).filter((x) => !inMembers.has(String(x.email).toLowerCase()));
  const m = { ...p, ...s, owner: s.owner || p.owner || null, members, invites };
  const owners = members.filter((x) => x.role === 'owner').map((x) => x.email); if (owners.length && !owners.includes(m.owner)) m.owner = owners[0]; /* as auth.js ownerFix */
  return { body: Buffer.from(JSON.stringify(m)), onlyProd };
}
/* a production row's parts as stored (a document production still keeps whole is split the way objects.js would) */
const partsOf = async (db, key, row) => (row.content_type === STUB ? (await db.query('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [key])).rows
  : (() => { try { return splitDoc(JSON.parse(row.body.toString('utf8')), { always: ALWAYS.test(key) }).map(([part, b], ord) => ({ part, ord, body: Buffer.from(b) })); } catch { return []; } })());
const iso = (d) => (d ? new Date(d).toISOString() : null);

/* src, dst: pg pools (staging, production). keys: { src, dst } vault keys. store: buckets (see gcsStore). apply false = a dry run.
   jams, sync: the words above. exportRows(name, jsonl): saves the production rows a sync apply replaces; it runs before any write
   and a throw from it stops the brand with nothing written. protect: brands whose connection rows are never written. */
export async function copyBrand({ src, dst, slug, keys, store, apply = false, jams = false, sync = false, exportRows = null, protect = PROTECTED(), log = console }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug === '_brew') throw new Error(`not a brand: ${slug}`);
  if (TEST_BRANDS.test(slug)) throw new Error(`${slug} is a test brand: it never goes to production`);
  const prot = protect.has(slug), skipOpt = { jams };
  const prefix = `brands/${slug}/`, r = { slug, rows: 0, parts: 0, copied: 0, same: 0, keptProd: 0, kept: [], replaced: [], conflicts: [], vault: [], skipped: {}, files: 0, filesCopied: 0, media: 0, mediaCopied: 0, mediaMissing: [], bytes: 0 };
  const rows = (await src.query(`SELECT key, body, content_type, updated_at FROM objects WHERE starts_with(key, $1) ORDER BY key`, [prefix])).rows;
  if (!rows.some((x) => x.key === `${prefix}status.json`)) throw new Error(`${slug}: no status.json on staging, not a built brand`);
  const refs = { research: new Set(), gen: new Set(), maybe: new Set() }, plan = [];
  for (const row of rows) {
    const rel = row.key.slice(prefix.length), why = skipWhy(rel, skipOpt);
    if (why) { r.skipped[why] = (r.skipped[why] || 0) + 1; continue; }
    if (row.content_type === STUB) {
      const parts = (await src.query('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [row.key])).rows;
      plan.push({ ...row, rel, parts }); mediaRefs(joinDocText(parts), refs);
    } else if (row.body?.length) {
      if (/^private\/vault\//.test(rel)) { const x = JSON.parse(row.body.toString('utf8')); if (!x.c) { r.skipped['an empty sign-in'] = (r.skipped['an empty sign-in'] || 0) + 1; continue; }
        const plain = decryptWith(keys.src, x.c); /* throws on a wrong key: nothing is written with a secret that can't be read */
        let kinds; try { kinds = Object.keys(JSON.parse(plain)).join(','); } catch { throw new Error(`${row.key}: the sign-in is not readable JSON`); } /* never the text itself */
        r.vault.push({ file: rel.slice('private/vault/'.length), kinds, at: new Date(x.at || 0).toISOString() });
        plan.push({ ...row, rel, vault: { at: x.at || Date.now(), plain } }); }
      else { const clean = SIM_FILES.test(rel) ? stripSim(row.body) : null; /* simulated connector data from staff testing never goes */
        if (clean) r.simStripped = (r.simStripped || 0) + clean.n;
        plan.push(clean ? { ...row, rel, body: clean.body } : { ...row, rel }); mediaRefs(row.body.toString('utf8'), refs); }
    } /* an empty body is a row locked for a first write that never came: nothing to copy */
  }
  r.rows = plan.length; r.parts = plan.reduce((n, x) => n + (x.parts?.length || 0), 0);
  /* 1. decide every row (reads only) */
  const todo = [], missing = [];
  for (const x of plan) {
    const cur = (await dst.query('SELECT body, content_type, src, version, updated_at FROM objects WHERE key = $1', [x.key])).rows[0];
    const prodWrote = !!cur && cur.src !== 'migrate';
    if (CONNECTION.test(x.rel)) {
      if (prot) { if (cur) { r.keptProd++; r.kept.push(x.key); } else missing.push(x.key); continue; } /* a protected brand's connections are never written */
      if (cur && (sync || prodWrote)) { r.keptProd++; r.kept.push(x.key); continue; }
    }
    let act;
    if (!cur) act = { kind: 'new' };
    else if (sync && x.parts) { /* merged on every sync run, so a part only production has survives the next run too */
      const now = await partsOf(dst, x.key, cur), m = mergeParts(x.parts, now);
      if (cur.content_type === STUB && partsSig(m.parts) === partsSig(now)) { r.same++; continue; }
      act = { kind: 'merge-parts', parts: m.parts, prodOnlyParts: m.kept, droppedParts: m.dropped };
    } else if (sync && MEMBERS.test(x.rel)) {
      const u = unionMembers(x.body, cur.content_type === STUB ? Buffer.from('{}') : cur.body);
      let same = false; try { same = cur.content_type !== STUB && JSON.stringify(JSON.parse(cur.body.toString('utf8'))) === u.body.toString('utf8'); } catch {}
      if (same) { r.same++; continue; }
      act = { kind: 'merge-members', body: u.body, prodOnlyMembers: u.onlyProd };
    } else if (prodWrote && !sync) { r.keptProd++; continue; } /* production wrote it after the copy: it is the truth now */
    else if (await sameAs(dst, x, cur, keys)) { r.same++; continue; }
    else act = { kind: 'overwrite' };
    todo.push({ x, cur, act });
    if (cur) r.replaced.push({ key: x.key, action: act.kind, by: prodWrote ? 'production' : 'copy', staging: iso(x.updated_at), production: iso(cur.updated_at),
      ...(act.prodOnlyParts ? { prodOnlyParts: act.prodOnlyParts, droppedParts: act.droppedParts } : {}), ...(act.prodOnlyMembers ? { prodOnlyMembers: act.prodOnlyMembers } : {}) });
  }
  if (missing.length) throw new Error(`STOP: ${slug} is protected and ${missing.length} connection row(s) are missing on production (${missing.join(', ')}); nothing written, and they are never copied over`);
  r.copied = todo.length; r.bytes = todo.reduce((n, { x }) => n + (x.parts ? x.parts.reduce((m, p) => m + p.body.length, 0) : x.body.length), 0);
  /* 2. sync: production's rows that will be replaced are exported first; no export, no write */
  const replacing = todo.filter((t) => t.cur);
  if (apply && sync && replacing.length) {
    if (!exportRows) throw new Error(`${slug}: sync needs an export of the rows it replaces; nothing written`);
    const lines = [];
    for (const { x, cur } of replacing) {
      lines.push(JSON.stringify({ t: 'object', key: x.key, content_type: cur.content_type, version: String(cur.version), updated_at: iso(cur.updated_at), src: cur.src, body: cur.body.toString('base64') }));
      if (cur.content_type === STUB) for (const p of (await dst.query('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [x.key])).rows) lines.push(JSON.stringify({ t: 'part', key: x.key, part: p.part, ord: p.ord, body: p.body.toString('base64') }));
    }
    await exportRows(`${slug}.jsonl`, lines.join('\n') + '\n'); /* a refused write throws here: nothing below runs */
  }
  /* 3. write, each guarded by the version read in 1: a row production changed meanwhile is reported, never clobbered */
  if (apply) for (const { x, cur, act } of todo) {
    const ok = await tx(dst, async (c) => {
      const parts = act.parts || x.parts, stamp = act.kind.startsWith('merge') && cur.updated_at > x.updated_at ? cur.updated_at : x.updated_at;
      const body = parts ? Buffer.alloc(0) : act.body || (x.vault ? Buffer.from(JSON.stringify({ c: encryptWith(keys.dst, x.vault.plain), at: x.vault.at })) : x.body);
      const type = parts ? STUB : x.content_type;
      const w = cur ? await c.query(`UPDATE objects SET body = $2, content_type = $3, updated_at = $4, src = 'migrate', version = nextval('objects_version') WHERE key = $1 AND version = $5`, [x.key, body, type, stamp, cur.version])
        : await c.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, $2, $3, $4, 'migrate') ON CONFLICT (key) DO NOTHING`, [x.key, body, type, stamp]);
      if (!w.rowCount) return false; /* production wrote it meanwhile */
      await c.query('DELETE FROM doc_parts WHERE key = $1', [x.key]);
      if (parts) for (const p of parts) await c.query('INSERT INTO doc_parts (key, part, ord, body) VALUES ($1, $2, $3, $4)', [x.key, p.part, p.ord, p.body]);
      return true;
    });
    if (!ok) { r.conflicts.push(x.key); r.copied--; }
  }
  /* the brand's own files (pictures, PDFs, statics): every non-row object outside the skipped folders */
  const files = (await store.list(store.src, prefix)).filter((f) => !isRow(f.name) && !skipWhy(f.name.slice(prefix.length), skipOpt));
  const have = new Map((await store.list(store.dst, prefix)).map((f) => [f.name, f.md5]));
  r.files = files.length;
  for (const f of files) { if (have.get(f.name) === f.md5) continue; r.filesCopied++; r.bytes += +f.size || 0; if (apply) await store.copy(store.src, f.name, store.dst, f.name); }
  await copyMedia(store, refs, apply, r);
  log.log?.(`[partner] ${slug} ${apply ? 'copied' : 'dry run'}: ${JSON.stringify({ ...r, kept: r.kept.length, replaced: r.replaced.length, mediaMissing: r.mediaMissing.length })}`);
  return r;
}
/* shared media the copied rows point at */
async function copyMedia(store, refs, apply, r) {
  const want = [...[...refs.research].map((n) => ({ to: `research-media/${n}`, from: [`research-media/${n}`, `media/${n}`] })), ...[...refs.gen].map((n) => ({ to: `gen/${n}`, from: [`gen/${n}`] })),
    ...[...refs.maybe].filter((n) => !refs.gen.has(n)).map((n) => ({ to: `gen/${n}`, from: [`gen/${n}`], maybe: true }))];
  r.media = want.filter((m) => !m.maybe).length;
  for (const m of want) {
    if (await store.exists(store.dst, m.to)) continue;
    let from = null; for (const k of m.from) if (await store.exists(store.src, k)) { from = k; break; }
    if (!from) { if (!m.maybe) r.mediaMissing.push(m.to); continue; } /* already missing on staging: the card shows what it shows there (a maybe was only a name) */
    r.mediaCopied++; if (apply) await store.copy(store.src, from, store.dst, m.to);
  }
}
const joinDocText = (parts) => { try { return JSON.stringify(joinDoc(parts)); } catch { return parts.map((p) => p.body.toString('utf8')).join('\n'); } };
async function sameAs(dst, x, cur, keys) {
  if (x.parts) { if (cur.content_type !== STUB) return false; return partsSig((await dst.query('SELECT part, ord, body FROM doc_parts WHERE key = $1', [x.key])).rows) === partsSig(x.parts); }
  if (cur.content_type === STUB) return false;
  if (x.vault) { try { return vaultPlain(cur.body, keys.dst) === JSON.stringify({ s: x.vault.plain, at: x.vault.at }); } catch { return false; } }
  return cur.content_type === x.content_type && md5(cur.body) === md5(x.body);
}
/* fn returning false rolls the transaction back (a guarded write that found the row changed) */
async function tx(pool, fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const out = await fn(c); await c.query(out === false ? 'ROLLBACK' : 'COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } }

/* workspaces: a partner's workspaces (tenants/t_*.json, with parts), only where production has no row with that key (ids are
   random, so nothing collides). Never a test brand's. slugs: the brands named in this run; only the design partners among them. */
export async function copyWorkspaces({ src, dst, slugs, store = null, apply = false, log = console }) {
  for (const s of slugs) if (TEST_BRANDS.test(s)) throw new Error(`${s} is a test brand: its workspaces never go to production`);
  const want = new Set(slugs.filter((s) => PARTNERS.includes(s)));
  const r = { rows: 0, copied: 0, exists: 0, testBrand: 0, otherBrand: 0, conflicts: [], keys: [], media: 0, mediaCopied: 0, mediaMissing: [] };
  const refs = { research: new Set(), gen: new Set(), maybe: new Set() };
  const rows = (await src.query(`SELECT key, body, content_type, updated_at FROM objects WHERE starts_with(key, 'tenants/') ORDER BY key`)).rows.filter((x) => /^tenants\/t_[a-f0-9]+\.json$/.test(x.key));
  for (const x of rows) {
    const parts = x.content_type === STUB ? (await src.query('SELECT part, ord, body FROM doc_parts WHERE key = $1 ORDER BY ord, part', [x.key])).rows : null;
    let brandId = null; try { brandId = parts ? JSON.parse(parts.find((p) => p.part === 'brandId')?.body.toString('utf8') ?? 'null') : JSON.parse(x.body.toString('utf8'))?.brandId; } catch {}
    if (brandId && TEST_BRANDS.test(String(brandId))) { r.testBrand++; continue; }
    if (!want.has(brandId)) { r.otherBrand++; continue; }
    if (!parts && !x.body?.length) continue;
    r.rows++;
    if ((await dst.query('SELECT 1 FROM objects WHERE key = $1', [x.key])).rowCount) { r.exists++; continue; } /* production's own, or an earlier copy: never touched */
    r.copied++; r.keys.push(x.key); mediaRefs(parts ? joinDocText(parts) : x.body.toString('utf8'), refs);
    if (!apply) continue;
    const ok = await tx(dst, async (c) => {
      const w = await c.query(`INSERT INTO objects (key, body, content_type, updated_at, src) VALUES ($1, $2, $3, $4, 'migrate') ON CONFLICT (key) DO NOTHING`, [x.key, parts ? Buffer.alloc(0) : x.body, x.content_type, x.updated_at]);
      if (!w.rowCount) return false;
      await c.query('DELETE FROM doc_parts WHERE key = $1', [x.key]);
      if (parts) for (const p of parts) await c.query('INSERT INTO doc_parts (key, part, ord, body) VALUES ($1, $2, $3, $4)', [x.key, p.part, p.ord, p.body]);
      return true; });
    if (!ok) { r.conflicts.push(x.key); r.copied--; }
  }
  if (store) await copyMedia(store, refs, apply, r);
  log.log?.(`[partner] workspaces ${apply ? 'copied' : 'dry run'}: ${JSON.stringify({ ...r, keys: r.keys.length, mediaMissing: r.mediaMissing.length })}`);
  return r;
}

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

/* the buckets through the JSON API: list (name, md5, size), exists, a server-side copy (rewrite, so nothing is downloaded), and
   put (a new object only: ifGenerationMatch=0, for the pre-sync export) */
export function gcsStore({ src, dst, token }) {
  const enc = encodeURIComponent, H = async () => ({ authorization: `Bearer ${await token()}` });
  const call = async (url, init = {}) => { for (let i = 0; ; i++) { const r = await fetch(url, { ...init, headers: { ...(await H()), ...(init.headers || {}) }, signal: AbortSignal.timeout(120e3) }); if (r.ok || r.status === 404 || i >= 4 || (r.status < 500 && r.status !== 429)) return r; await new Promise((s) => setTimeout(s, 500 * 2 ** i)); } };
  return { src, dst,
    async list(bucket, prefix) { const out = []; let pt = ''; do { const r = await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${enc(prefix)}&fields=items(name,md5Hash,size),nextPageToken${pt ? '&pageToken=' + enc(pt) : ''}`); if (!r.ok) throw new Error(`list ${bucket}/${prefix} ${r.status}`); const j = await r.json(); for (const x of j.items || []) out.push({ name: x.name, md5: x.md5Hash || null, size: +x.size || 0 }); pt = j.nextPageToken || ''; } while (pt); return out; },
    async exists(bucket, name) { const r = await call(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${enc(name)}?fields=name`); if (r.status === 404) return false; if (!r.ok) throw new Error(`stat ${bucket}/${name} ${r.status}`); return true; },
    async copy(fromB, from, toB, to) { let rt = ''; do { const r = await call(`https://storage.googleapis.com/storage/v1/b/${fromB}/o/${enc(from)}/rewriteTo/b/${toB}/o/${enc(to)}${rt ? '?rewriteToken=' + enc(rt) : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error(`copy ${from} → ${toB}/${to} ${r.status}`); const j = await r.json(); rt = j.done ? '' : j.rewriteToken; } while (rt); },
    async put(bucket, name, body, type = 'application/json') { const r = await call(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${enc(name)}`, { method: 'POST', headers: { 'content-type': type }, body });
      if (!r.ok) throw new Error(`write gs://${bucket}/${name} ${r.status}${r.status === 403 ? ' (refused: IAM)' : ''}`); } };
}
