// Connected-account secrets (OAuth tokens, pasted API keys), encrypted at rest in the brand's private folder.
// AES-256-GCM, ciphertext = base64(iv · tag · payload), the same format as SquareUp's vault. The key lives only in
// FEED_VAULT_KEY (64 hex chars, Secret Manager). Tokens never leave the server and are never logged.
import crypto from 'node:crypto';

const IV = 12, TAG = 16;
const key = () => {
  const k = process.env.FEED_VAULT_KEY || (process.env.K_SERVICE ? '' : crypto.createHash('sha256').update('shopos-feed-local-vault').digest('hex'));
  if (!/^[0-9a-f]{64}$/i.test(k)) throw new Error('FEED_VAULT_KEY is not set');
  return Buffer.from(k, 'hex');
};
export const encrypt = (plain) => { const iv = crypto.randomBytes(IV), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'); };
export const decrypt = (b64) => { const raw = Buffer.from(String(b64), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, IV)); d.setAuthTag(raw.subarray(IV, IV + TAG)); return Buffer.concat([d.update(raw.subarray(IV + TAG)), d.final()]).toString('utf8'); };

// one file per brand and account: brands/<slug>/private/vault/<id>.json = { c: ciphertext, at }
export function createVault(packs) {
  const name = (id) => `private/vault/${String(id).replace(/[^a-z0-9-]/g, '')}.json`;
  return {
    async save(slug, id, secret) { await packs.put(slug, name(id), { c: encrypt(JSON.stringify(secret)), at: Date.now() }); },
    async load(slug, id) { const x = await packs.getJSON(slug, name(id), null); if (!x?.c) return null; try { return JSON.parse(decrypt(x.c)); } catch { return null; } },
    async drop(slug, id) { await packs.put(slug, name(id), { c: null, at: Date.now() }); },
    /* the secret refreshed by fn(current) → next under the row's lock when the store has one (Postgres): whoever comes second
       gets the refreshed secret and fn sees a token that needs nothing. fn returning the same object writes nothing */
    refresh: packs.update ? async (slug, id, fn) => { let out = null;
      await packs.update(slug, name(id), async (x) => { const cur = x?.c ? JSON.parse(decrypt(x.c)) : null; if (!cur) { out = null; return undefined; }
        const next = await fn(cur); out = next; return next === cur ? undefined : { c: encrypt(JSON.stringify(next)), at: Date.now() }; });
      return out; } : null
  };
}
