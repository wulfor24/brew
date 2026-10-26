// The product is Brew. Workspaces and brand packs saved before the rename still say ShopOS (stages, agents and
// kinds named 'shopos', "ShopOS team" in copy, "SHOPOS ×" in move docs): they are read through this, so old data
// speaks Brew without a rewrite. Infra names (the shopos-feed Cloud Run service) are left alone.
const RE = /SHOPOS\.AI|SHOPOS|ShopOS|Shopos|shopOS|shopos(?!-feed)/g;
const TO = { 'SHOPOS.AI': 'BREW', SHOPOS: 'BREW', ShopOS: 'Brew', Shopos: 'Brew', shopOS: 'brew', shopos: 'brew' };
const OLD_COPY = [['Heart it, remix it, jam on it, ship it.', 'Heart it, jam on it, share the brief.'], ['Heart it, jam on it, do it.', 'Heart it, jam on it, share the brief.'],
  // moves written before 2026-10-15 promised a watching loop that was cut: they read honestly without a paid rewrite
  ['What Brew will watch:', 'What to watch:'], ['Fifty-one moves, turned into cards.', 'Your plays, turned into cards.'], ['BREW SHIPS', 'BREW DRAFTS'], ['between checks Brew re-reads', 'between checks, also look at']]; // saved packs heal on read // remix folded into the jam
// move kickers said "MOVE 24 OF 64" with a total that changed as the playbook grew ("MOVE 65 OF 64"): now just the number
const OLD_RX = [[/( · MOVE \d{2,4}) OF \d{2,3}\b/g, '$1'],
  // the index once baked a count into its title ("Sixty-four moves for Arata"), which drifted as moves were added
  [/\b(?:Fifty|Sixty|Seventy|Eighty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))? moves for\b/g, 'The plays for'],
  // moves written before 2026-10-15 said Brew watches, re-reads, pauses or reverts: the team runs those checks
  [/\b(B|b)etween checks,? Brew re-reads\b/g, '$1etween checks, look at'], [/\bat each check,? Brew re-reads\b/gi, 'at each check, look at'],
  [/\bBrew re-reads\b/g, 'the team looks at'], [/\bBrew watches\b/g, 'The team watches'], [/(^|[.!?]\s+)Brew ships it\b/g, '$1The team ships it'], [/\bBrew ships it\b/g, 'the team ships it'],
  [/\b(W|w)e (pause|revert|roll back|stop)\b/g, (m, w, v) => `${w === 'W' ? 'The' : 'the'} team should ${v === 'roll back' ? 'roll back' : v}`],
  /* moves named Brew people who do the work ("a Brew growth analyst reviews it within 48 hours", "the Brew deployment team runs"):
     Brew drafts, the brand's own team ships (or sends the brief to the ShopOS team), so the owner is the brand's role (Param, 20 Oct) */
  [/(^|["\n|]\s*|[.!?]\s+)?\b(?:(an?|the|our)\s+)?Brew(?:['’]s)?\s+((?:(?!(?:drafts?|does|did|will|is|has|can|and|or|the|to|for|of|with|listening|calendar|reads?|finds?|hears?|counts?|writes?|makes?)\b)[A-Za-z][A-Za-z-]*\s+){0,2}(?:analyst|lead|copywriter|developer|designer|strategist|writer|manager|buyer|team|engineer|specialist|editor|producer|expert|operator))(s?)\b/gi,
    (m, pre = '', art, role, pl, off, str) => { const r = String(role).toLowerCase().replace(/\s+/g, ' ');
      if (r === 'team') return m; /* "the ShopOS team" (the build crew, read as "Brew team") stays */
      if (/team$/.test(r) && str[off + m.length] === '"') return m; /* a card's source line that is only the team's name stays */
      const who = /^(?:deployment|development) team$/.test(r) ? 'team' : r; const out = `your ${who}${pl && who !== 'team' ? 's' : ''}`;
      const cap = pre !== undefined && pre !== '' ? true : /^[A-Z]/.test(art || '') ; return `${pre || ''}${cap ? out[0].toUpperCase() + out.slice(1) : out}`; }],
  [/\bBrew will (monitor|build|run|ship|review|own|handle|track|manage)\b/g, 'your team will $1'], [/(^|[.!?]\s+)your team will/g, '$1Your team will'],
  /* saved copy that names our team ("send the brief to the ShopOS team", read as "the Brew team") says "our team" (copy rules, 26 Oct) */
  [/\b([Tt])he Brew team\b/g, (m, t) => (t === 'T' ? 'Our team' : 'our team')]];
/* an address is a name, not copy: sai@shopos.ai, https://shopos.ai/x and shopos.ai stay as written (the rename once turned
   invited emails into @brew.ai, so invites and members on that domain could never match their Google sign-in) */
const inAddress = (s, i, m) => { let a = i, b = i + m.length; while (a > 0 && !/[\s"'<>(),;]/.test(s[a - 1])) a--; while (b < s.length && !/[\s"'<>(),;]/.test(s[b])) b++;
  const tok = s.slice(a, b); return tok.includes('@') || /:\/\/|^www\./i.test(tok) || /^shopos\.[a-z]{2,}/.test(s.slice(i)); };
export const brewText = (s) => { if (typeof s !== 'string') return s; let t = /shopos/i.test(s) ? s.replace(RE, (m, i) => inAddress(s, i, m) ? m : TO[m] ?? 'brew') : s; for (const [a, b] of OLD_COPY) if (t.includes(a)) t = t.split(a).join(b); for (const [re, b] of OLD_RX) t = t.replace(re, b); return t; };
// a stored file: only text that we wrote (JSON, JS, Markdown, HTML, text), never secrets or binaries
/* some generated packs stored "₹" as the text \u20b9 (escaped twice), and workspaces copied it: read it back as the character.
   Works on JSON text; control characters stay escaped so the JSON still parses. */
const TWICE = /\\\\u[0-9a-fA-F]{4}/;
export const onceEscaped = (s) => (TWICE.test(s) ? s.replace(/\\\\u([0-9a-fA-F]{4})/g, (_, h) => parseInt(h, 16) < 32 ? `\\u${h}` : String.fromCharCode(parseInt(h, 16)).replace(/["\\]/g, (c) => `\\${c}`)) : s);
/* moves written before 2026-10-15 narrated their source method ("This skill was written for software, so three terms need
   translating… Where it says G2 and Capterra, read …"; "the skill's rollout rule"). The reader is the brand's team: those
   sentences leave, and "the skill says X" reads as the practice itself. Saved moves heal on read, every brand, no rewrite */
const SKILL_HINT = /\b(?:the|this|The|This)(?: [a-z]+)? (?:skill|playbook)\b|\bIn SaaS\b|\bapplies to [^.]{1,40} directly\b|\bG2\b|\bCapterra\b/;
const LEAK_SENT = new RegExp([
  String.raw`\b(?:skill|playbook|discipline)\b[^.!?]{0,140}\b(?:written (?:for|with)|built for|in mind)\b`,
  String.raw`\bIn SaaS\b`, String.raw`\bWhere (?:it|the skill|the playbook) \w+`, String.raw`\bneeds? translating\b`,
  String.raw`\b(?:here is the|first a|so a|Two) translations?\b`, String.raw`\btranslate it first\b`, String.raw`\bread it this way\b`,
  String.raw`\bapplies to [^.!?]{1,40} directly\b`, String.raw`\b(?:G2|Capterra)\b`].join('|'));
/* a sentence ends at . ! ? followed by a space and a capital, digit, quote or ₹ (so 'Judge.me' and 'arata.in' stay whole) */
const SPLIT = /(?<=[.!?]["”’)]*)(\s+)(?=[A-Z“"‘(₹0-9])/;
export const unSkill = (s) => {
  if (typeof s !== 'string' || !SKILL_HINT.test(s)) return s;
  let t = s; if (s.length >= 40) { const parts = s.split(SPLIT), sents = parts.filter((_, k) => k % 2 === 0); /* split keeps the spaces at odd places */
    const leak = sents.map((x) => (x.trim().length >= 40 || /read it this way/.test(x)) && LEAK_SENT.test(x));
    const kept = sents.filter((x, k) => !leak[k] && !(k > 0 && leak[k - 1] && /^(They|These|Those)\b/.test(x.trim()))); /* a 'They …' right after a dropped sentence points at nothing */ if (kept.length !== sents.length) t = kept.join(' ').trim(); }
  t = t.replace(/\b(T|t)he(?: [a-z]+)? (?:skill|playbook)['’]s (?=\S)/g, (m, c) => `${c}he `)
    .replace(/\b(T|t)he(?: [a-z]+)? (?:skill|playbook) (says|asks|sets|builds|brings|requires|wants|warns|rates|sends|offers|scores|advises|calls|puts|treats|uses|recommends|suggests|lists|names|gives|flags|allows|rules)\b/g, (m, c, v) => `${c === 'T' ? 'Good' : 'good'} practice ${v}`)
    .replace(/ from the (?:skill|playbook)\b/g, '').replace(/\b(follows|per|under) the (?:skill|playbook)\b/g, '$1 good practice');
  return t.trim() === '' ? '' : t;
};
const unSkillDeep = (o) => Array.isArray(o) ? o.map((x) => [x, unSkillDeep(x)]).filter(([x, y]) => !(y && typeof y === 'object' && y.healed) && !(typeof x === 'string' && x && y === '')).map(([, y]) => y)
  : o && typeof o === 'object' ? (() => { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = unSkillDeep(v); if (r.t === 'p' && typeof o.text === 'string' && o.text && r.text === '') r.healed = true; return r; })()
  : unSkill(o);
export const unSkillJSON = (s) => { if (!SKILL_HINT.test(s)) return s; try { const j = JSON.parse(s), h = unSkillDeep(j); const out = JSON.stringify(h); return out === JSON.stringify(j) ? s : out; } catch { return s; } };
export const brewFile = (name, buf) => {
  if (!buf || !/\.(json|js|md|txt|html)$/i.test(name) || /(^|\/)(private\/vault|vault)\b/.test(name)) return buf;
  const s = buf.toString('utf8'), esc = /\.json$/i.test(name) && TWICE.test(s);
  let t = esc || /shopos|remix it, jam|jam on it, do it|What Brew will watch|BREW SHIPS|Brew re-reads|Brew watches|Brew ships|\bwe (?:pause|revert|roll back|stop)\b|(?:Fifty|Sixty|Seventy|Eighty)[- ]?\w* moves for|Fifty-one moves|MOVE \d+ OF \d+|\bBrew(?:['’]s)? (?:\w+ )?(?:analyst|lead|copywriter|developer|designer|strategist|writer|manager|buyer|team|engineer|specialist|editor|producer|expert|operator)|\bBrew will (?:monitor|build|run|ship|review|own|handle|track|manage)\b/i.test(s) ? brewText(esc ? onceEscaped(s) : s) : s;
  if (/\.(json|md)$/i.test(name) && /(^|\/)(moves(\.json|\/)|seed\.json$)/.test(name) && SKILL_HINT.test(t)) t = /\.json$/i.test(name) ? unSkillJSON(t) : t.split('\n').map(unSkill).join('\n'); /* moves: no source-method narration */
  if (/\.json$/i.test(name) && /(^|\/)(jams\.json$|drafts\/|moves(\.json|\/)|seed\.json$)/.test(name) && t.includes('\\\\n')) t = t.replace(/\\\\n/g, '\\n'); /* a saved reply that wrote line breaks as the two characters \ n (ai.js realNewlines) reads with real ones */
  if (/\.json$/i.test(name) && t.includes('\u2039')) t = t.replace(/\u2039(?=\s?\d)/g, '₹'); /* ₹ the model wrote as ‹ ("Only ‹419") reads as ₹ in every saved file */
  return t === s ? buf : Buffer.from(t, 'utf8');
};
