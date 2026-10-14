// Company facts: founders, founding year, HQ, funding, revenue, recent press, from Claude with web search.
// Every fact must carry a URL that the search actually returned; anything unsourced is dropped.
import { hostOf } from '../util.js';

export async function company(ctx) {
  const { profile, ledger } = ctx;
  if (!ctx.aiOn) return;
  ctx.tick('company', 'web search');
  const r = await ctx.ai({ tag: 'reader-company', model: 'sonnet', search: 6, location: profile.country || undefined, max: 4000,
    system: 'You are a careful researcher. Report only facts that a page you found states directly. Every fact needs the exact URL of that page and the page\'s date when shown. Never infer, estimate or round. If a fact is not found, leave it out. "value" holds only the value (a name, a year, a city, an amount), never commentary. When sources disagree, list each source\'s value as its own fact. Use they/them for people.',
    prompt: `Company research for the brand ${profile.name} (website ${profile.host}${profile.country ? `, ${profile.country}` : ''}${profile.category ? `, ${profile.category}` : ''}). Be sure each fact is about this company and not a namesake.\nFind: founders (names and role), founding year, headquarters city, funding rounds (round, amount, date, lead investors), revenue figures (value and period, e.g. FY25), and up to 5 recent press articles (title, outlet, date).\nReturn JSON only:\n{"facts":[{"field":"founder|founded|hq|funding|revenue|press|investor","value":"...","round":"","amount":"","period":"","date":"YYYY-MM-DD or YYYY-MM or YYYY","outlet":"","url":"https://...","quote":"the exact sentence on the page"}]}`, json: true });
  const cited = new Set((r.cites || []).map((c) => c.url.replace(/[#?].*$/, '').replace(/\/$/, '')));
  const citedHosts = new Set((r.cites || []).map((c) => hostOf(c.url)));
  const norm = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/$/, '');
  // keep a fact only when its URL is one the search really returned
  const facts = (r.json?.facts || []).filter((f) => f.url && f.value && cited.has(norm(f.url)));
  const dropped = (r.json?.facts || []).length - facts.length;
  const c = profile.company = { founders: [], founded: null, hq: null, funding: [], revenue: [], press: [], investors: [], dropped };
  const add = (key, label, f, extra = {}) => ledger.add({ key, label, v: String(f.value).slice(0, 200), url: f.url, method: 'claude:web_search', layer: 'observed',  note: [f.date ? `dated ${f.date}` : null, f.quote ? `"${String(f.quote).slice(0, 200)}"` : null].filter(Boolean).join(' · ') || undefined, ...extra });
  for (const f of facts) {
    if (f.field === 'founder') { c.founders.push({ name: f.value, url: f.url }); add(`company.founder.${c.founders.length}`, 'Founder', f); }
    else if (f.field === 'founded') { const y = +(String(f.value).match(/\b(19|20)\d{2}\b/) || [])[0]; (c.foundedAll ||= []).push({ v: f.value, url: f.url }); c.founded ||= f.value; add(c.foundedAll.length === 1 ? 'company.founded' : `company.founded.${c.foundedAll.length}`, c.foundedAll.length === 1 ? 'Founded' : 'Founded (another source)', f, y ? { n: y, unit: 'year' } : {}); }
    else if (f.field === 'hq') { (c.hqAll ||= []).push({ v: f.value, url: f.url }); c.hq ||= f.value; add(c.hqAll.length === 1 ? 'company.hq' : `company.hq.${c.hqAll.length}`, 'Headquarters', f); }
    else if (f.field === 'funding') { c.funding.push({ round: f.round || null, amount: f.amount || f.value, date: f.date || null, url: f.url }); add(`company.funding.${c.funding.length}`, `Funding${f.round ? ' · ' + f.round : ''}`, { ...f, value: [f.round, f.amount || f.value, f.date].filter(Boolean).join(', ') }); }
    else if (f.field === 'revenue') { c.revenue.push({ v: f.value, period: f.period || f.date || null, url: f.url }); add(`company.revenue.${c.revenue.length}`, `Revenue${f.period ? ' ' + f.period : ''}`, f); }
    else if (f.field === 'investor') { c.investors.push({ name: f.value, url: f.url }); add(`company.investor.${c.investors.length}`, 'Investor', f); }
    else if (f.field === 'press' && c.press.length < 5) { c.press.push({ title: f.value, url: f.url, date: f.date || null, outlet: f.outlet || hostOf(f.url) }); add(`company.press.${c.press.length}`, `Press: ${f.outlet || hostOf(f.url)}`, f); }
  }
  ctx.done('company', `${facts.length} sourced facts${dropped ? `, ${dropped} unsourced dropped` : ''}`);
}
