// The AI-answers gap card's fix (QA FEED-ARV-09): one specific fix per gap, from what Brew already holds — the question, the
// rival the answers named instead, and the brand's own page or product that fits it — never one template for every gap.
// Pure: no AI, no treg, no reads.
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const KINDS = [
  ['compare', /\b(vs\.?|versus|better than|compared?\s+(?:to|with)|alternatives?|instead of|or\s+\w+\s*\?)/i],
  ['proof', /\b(actually|really|does .+ work|works?|results?|effective|proof|proven|clinical(?:ly)?|worth it|legit)\b/i],
  ['safe', /\b(safe|side[- ]effects?|ingredients?|without|free from|-free\b|sulphates?|sulfates?|parabens?|chemicals?|natural|organic|allerg\w*|sensitive|pregnan\w*)\b/i],
  ['price', /\b(price|prices|cost|costs|cheap\w*|afford\w*|budget|under\s+[₹$€£]?\s?\d+|below\s+[₹$€£]?\s?\d+|rupees|dollars)\b/i],
  ['best', /\b(best|top|which|recommend\w*|suggest\w*|good)\b/i],
  ['howto', /^(how|what|why|when|can|should|is|are|do|does)\b/i]
];
export const gapKind = (q) => (KINDS.find(([, re]) => re.test(String(q || ''))) || ['other'])[0];

/* q: the question; rivals: who the answers named instead; product: { t, url } the brand's product that fits it (or null);
   brand, host: the brand's name and site */
export function gapFix({ q = '', rivals = [], product = null, brand = 'the brand', host = 'your site' } = {}) {
  const kind = gapKind(q), rival = rivals[0] || null, page = product?.t ? `the ${cut(product.t, 40)} page` : `a buyer’s guide page on ${host}`;
  /* the question is cut to fit the title's 90 characters inside its quotes, so the closing quote is never the part cut off (final QA pass 19 Oct, FEED-ARV-13) */
  const lead = `Get ${brand} named when shoppers ask `, quote = `“${cut(String(q).replace(/\?$/, ''), Math.max(20, Math.min(70, 90 - lead.length - 2)))}”`;
  const fix = {
    compare: `a comparison section on ${page}: ${brand}${rival ? ` and ${rival}` : ' and the other names'}, side by side, with what makes ${brand} different`,
    proof: `a proof block on ${page}: what it does, how long it takes, and the reviews that say so`,
    safe: `an ingredients FAQ on ${page} that answers the question in its first line`,
    price: `an FAQ block on ${page} that answers it with the price and pack sizes`,
    howto: `a short answer block on ${page} that answers it in two sentences`,
    best: `an FAQ block on ${page} that answers it in its first line, with the proof`,
    other: `an FAQ block on ${page} that answers it directly`
  }[kind];
  return { kind, fix, page: product?.t ? cut(product.t, 40) : 'A new guide page', url: product?.url || null, rival,
    title: `${lead}${quote}` /* the benefit first (plain.js rule), the question second */ };
}
