// The product is Brew. Workspaces and brand packs saved before the rename still say ShopOS (stages, agents and
// kinds named 'shopos', "ShopOS team" in copy, "SHOPOS ×" in move docs): they are read through this, so old data
// speaks Brew without a rewrite. Infra names (the shopos-feed Cloud Run service) are left alone.
const RE = /SHOPOS\.AI|SHOPOS|ShopOS|Shopos|shopOS|shopos(?!-feed)/g;
const TO = { 'SHOPOS.AI': 'BREW', SHOPOS: 'BREW', ShopOS: 'Brew', Shopos: 'Brew', shopOS: 'brew', shopos: 'brew' };
const OLD_COPY = [['Heart it, remix it, jam on it, ship it.', 'Heart it, jam on it, do it.']]; // remix folded into the jam
export const brewText = (s) => { if (typeof s !== 'string') return s; let t = /shopos/i.test(s) ? s.replace(RE, (m) => TO[m] ?? 'brew') : s; for (const [a, b] of OLD_COPY) if (t.includes(a)) t = t.split(a).join(b); return t; };
// a stored file: only text that we wrote (JSON, JS, Markdown, HTML, text), never secrets or binaries
/* some generated packs stored "₹" as the text \u20b9 (escaped twice), and workspaces copied it: read it back as the character.
   Works on JSON text; control characters stay escaped so the JSON still parses. */
const TWICE = /\\\\u[0-9a-fA-F]{4}/;
export const onceEscaped = (s) => (TWICE.test(s) ? s.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => parseInt(h, 16) < 32 ? `\\u${h}` : String.fromCharCode(parseInt(h, 16)).replace(/["\\]/g, (c) => `\\${c}`)) : s);
export const brewFile = (name, buf) => {
  if (!buf || !/\.(json|js|md|txt|html)$/i.test(name) || /(^|\/)(private\/vault|vault)\b/.test(name)) return buf;
  const s = buf.toString('utf8'), esc = /\.json$/i.test(name) && TWICE.test(s); if (!esc && !/shopos|remix it, jam/i.test(s)) return buf;
  const t = brewText(esc ? onceEscaped(s) : s); return t === s ? buf : Buffer.from(t, 'utf8');
};
