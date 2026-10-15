// The product is Brew. Workspaces and brand packs saved before the rename still say ShopOS (stages, agents and
// kinds named 'shopos', "ShopOS team" in copy, "SHOPOS ×" in move docs): they are read through this, so old data
// speaks Brew without a rewrite. Infra names (the shopos-feed Cloud Run service) are left alone.
const RE = /SHOPOS\.AI|SHOPOS|ShopOS|Shopos|shopOS|shopos(?!-feed)/g;
const TO = { 'SHOPOS.AI': 'BREW', SHOPOS: 'BREW', ShopOS: 'Brew', Shopos: 'Brew', shopOS: 'brew', shopos: 'brew' };
const OLD_COPY = [['Heart it, remix it, jam on it, ship it.', 'Heart it, jam on it, share the brief.'], ['Heart it, jam on it, do it.', 'Heart it, jam on it, share the brief.'],
  // moves written before 2026-10-15 promised a watching loop that was cut: they read honestly without a paid rewrite
  ['What Brew will watch:', 'What to watch:'], ['Fifty-one moves, turned into cards.', 'Your moves, turned into cards.'], ['BREW SHIPS', 'BREW DRAFTS'], ['between checks Brew re-reads', 'between checks, also look at']]; // saved packs heal on read // remix folded into the jam
// move kickers said "MOVE 24 OF 64" with a total that changed as the playbook grew ("MOVE 65 OF 64"): now just the number
const OLD_RX = [[/( · MOVE \d{2,4}) OF \d{2,3}\b/g, '$1'],
  // the index once baked a count into its title ("Sixty-four moves for Arata"), which drifted as moves were added
  [/\b(?:Fifty|Sixty|Seventy|Eighty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))? moves for\b/g, 'The moves for'],
  // moves written before 2026-10-15 said Brew watches, re-reads, pauses or reverts: the team runs those checks
  [/\b(B|b)etween checks,? Brew re-reads\b/g, '$1etween checks, look at'], [/\bat each check,? Brew re-reads\b/gi, 'at each check, look at'],
  [/\bBrew re-reads\b/g, 'the team looks at'], [/\bBrew watches\b/g, 'The team watches'], [/(^|[.!?]\s+)Brew ships it\b/g, '$1The team ships it'], [/\bBrew ships it\b/g, 'the team ships it'],
  [/\b(W|w)e (pause|revert|roll back|stop)\b/g, (m, w, v) => `${w === 'W' ? 'The' : 'the'} team should ${v === 'roll back' ? 'roll back' : v}`]];
export const brewText = (s) => { if (typeof s !== 'string') return s; let t = /shopos/i.test(s) ? s.replace(RE, (m) => TO[m] ?? 'brew') : s; for (const [a, b] of OLD_COPY) if (t.includes(a)) t = t.split(a).join(b); for (const [re, b] of OLD_RX) t = t.replace(re, b); return t; };
// a stored file: only text that we wrote (JSON, JS, Markdown, HTML, text), never secrets or binaries
/* some generated packs stored "₹" as the text \u20b9 (escaped twice), and workspaces copied it: read it back as the character.
   Works on JSON text; control characters stay escaped so the JSON still parses. */
const TWICE = /\\\\u[0-9a-fA-F]{4}/;
export const onceEscaped = (s) => (TWICE.test(s) ? s.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => parseInt(h, 16) < 32 ? `\\u${h}` : String.fromCharCode(parseInt(h, 16)).replace(/["\\]/g, (c) => `\\${c}`)) : s);
export const brewFile = (name, buf) => {
  if (!buf || !/\.(json|js|md|txt|html)$/i.test(name) || /(^|\/)(private\/vault|vault)\b/.test(name)) return buf;
  const s = buf.toString('utf8'), esc = /\.json$/i.test(name) && TWICE.test(s); if (!esc && !/shopos|remix it, jam|jam on it, do it|What Brew will watch|BREW SHIPS|Brew re-reads|Brew watches|Brew ships|\bwe (?:pause|revert|roll back|stop)\b|(?:Fifty|Sixty|Seventy|Eighty)[- ]?\w* moves for|Fifty-one moves|MOVE \d+ OF \d+/i.test(s)) return buf;
  const t = brewText(esc ? onceEscaped(s) : s); return t === s ? buf : Buffer.from(t, 'utf8');
};
