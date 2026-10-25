// Connected-account secrets (OAuth tokens, pasted API keys), encrypted at rest in the brand's private folder.
// AES-256-GCM, ciphertext = base64(iv · tag · payload), the same format as SquareUp's vault. The key lives only in
// FEED_VAULT_KEY (64 hex chars, Secret Manager). Tokens never leave the server and are never logged.
import crypto from 'node:crypto';
import { isProtected } from './connectors/protected.js';

const IV = 12, TAG = 16;
const key = () => {
  const k = process.env.FEED_VAULT_KEY || (process.env.K_SERVICE ? '' : crypto.createHash('sha256').update('shopos-feed-local-vault').digest('hex'));
  if (!/^[0-9a-f]{64}$/i.test(k)) throw new Error('FEED_VAULT_KEY is not set');
  return Buffer.from(k, 'hex');
};
/* with a key given (64 hex chars): the partner copy (db/partner-copy.js) decrypts with staging's key and encrypts with production's */
const keyBuf = (k) => { if (!/^[0-9a-f]{64}$/i.test(String(k || ''))) throw new Error('vault key is not 64 hex chars'); return Buffer.from(k, 'hex'); };
export const encryptWith = (k, plain) => { const iv = crypto.randomBytes(IV), c = crypto.createCipheriv('aes-256-gcm', Buffer.isBuffer(k) ? k : keyBuf(k), iv); const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'); };
export const decryptWith = (k, b64) => { const raw = Buffer.from(String(b64), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.isBuffer(k) ? k : keyBuf(k), raw.subarray(0, IV)); d.setAuthTag(raw.subarray(IV, IV + TAG)); return Buffer.concat([d.update(raw.subarray(IV + TAG)), d.final()]).toString('utf8'); };
export const encrypt = (plain) => encryptWith(key(), plain);
export const decrypt = (b64) => decryptWith(key(), b64);

// one file per brand and account: brands/<slug>/private/vault/<id>.json = { c: ciphertext, at }
export function createVault(packs) {
  const name = (id) => `private/vault/${String(id).replace(/[^a-z0-9-]/g, '')}.json`;
  return {
    /* a protected brand's stored sign-in is never replaced by a new one (connectors/index.js finish refuses first; this is the
       last line). A refresh of the same sign-in, a sign-in still waiting for its account pick, and an admin's force go through */
    async save(slug, id, secret, { refresh = false, force = false } = {}) {
      if (!refresh && !force && !/-pending-/.test(String(id)) && isProtected(slug) && (await packs.getJSON(slug, name(id), null))?.c) throw Object.assign(new Error(`${slug} ${id}: a protected connection is never replaced`), { protected: true });
      await packs.put(slug, name(id), { c: encrypt(JSON.stringify(secret)), at: Date.now() }); },
    async load(slug, id) { const x = await packs.getJSON(slug, name(id), null); if (!x?.c) return null; try { return JSON.parse(decrypt(x.c)); } catch { return null; } },
    async drop(slug, id) { await packs.put(slug, name(id), { c: null, at: Date.now() }); },
    /* the secret refreshed by fn(current) → next, by one instance at a time (Postgres), without holding a database connection
       while the provider answers: a short locked write claims the refresh, the provider is asked outside any transaction, a
       second short write stores the result at once. An instance that finds a refresh claimed waits for it (up to 20 s) and
       uses the new secret; a claim older than 60 s (its instance died) is taken over. fn returning the same object writes nothing */
    refresh: packs.update ? async (slug, id, fn) => {
      const f = name(id), me = Math.random().toString(36).slice(2);
      for (let waited = 0; ; waited += 500) {
        let mine = false, cur = null, claimedC = null;
        await packs.update(slug, f, async (x) => { if (!x?.c) return undefined; cur = JSON.parse(decrypt(x.c)); claimedC = x.c;
          if (x.lk && x.lk.until > Date.now()) return undefined; mine = true; return { ...x, lk: { by: me, until: Date.now() + 60e3 } }; });
        if (!cur) return null;
        if (!mine) { if (waited >= 20e3) return cur; await new Promise((r) => setTimeout(r, 500)); continue; } /* another instance is refreshing: its result is read next */
        let next;
        try { next = await fn(cur); }
        catch (e) { await packs.update(slug, f, async (x) => (x?.lk?.by === me ? { ...x, lk: null } : undefined)).catch(() => {}); throw e; } /* refused: the old secret stays */
        /* only while the claim is still this instance's: a refresh slower than the claim (60 s) was taken over, and that one's newer
           (rotating) token is never overwritten with this older one */
        let kept = true;
        /* taken over while this one waited on the provider: still written when the stored token is the one this refresh started from
           (nobody wrote a newer one), so a rotated refresh token is never thrown away; a newer one already there is kept */
        await packs.update(slug, f, async (x) => { if (!x) return undefined; if (x.lk?.by !== me && x.c !== claimedC) { kept = false; return undefined; } return next === cur ? { ...x, lk: null } : { c: encrypt(JSON.stringify(next)), at: Date.now(), lk: null }; });
        if (!kept) { const now = await packs.getJSON(slug, f, null).catch(() => null); return now?.c ? JSON.parse(decrypt(now.c)) : next; }
        return next;
      }
    } : null
  };
}
