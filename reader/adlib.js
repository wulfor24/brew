// Free Meta Ad Library reader: opens the public Ad Library page in headless Chromium and reads the results the
// page embeds in its own HTML (search_results_connection). Same shape as treg's ScrapeCreators endpoints, so the
// ads stage can fall back to it when treg fails (no balance, outage) and never mistakes an error for "no ads".
import { launchBrowser } from '../pdf/render.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let browserP = null; let idle = null; let busy = 0; const waiters = [];
const MAX = 2;

async function browser() {
  clearTimeout(idle);
  if (!browserP) browserP = launchBrowser().catch((e) => { browserP = null; throw e; });
  return browserP;
}
function release() {
  busy--; const next = waiters.shift(); if (next) next();
  if (!busy && !waiters.length) { clearTimeout(idle); idle = setTimeout(async () => { const b = browserP; browserP = null; if (b) (await b.catch(() => null))?.close().catch(() => {}); }, 60e3); idle.unref?.(); }
}
async function slot() { if (busy >= MAX) await new Promise((ok) => waiters.push(ok)); busy++; }

// the JSON object that follows `"search_results_connection":` in the page, cut out by bracket matching
function connectionOf(html) {
  const at = html.indexOf('"search_results_connection":');
  if (at < 0) return null;
  let i = html.indexOf('{', at); const start = i; let depth = 0; let str = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; }
  }
  try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
}

/** Live ads from the public Ad Library. { q } searches by keyword, { pageId } reads one page.
 *  Returns { results, searchResults, searchResultsCount } (results === searchResults). */
export async function adLibrary(o = {}) {
  try { return await readOnce(o); } catch (e) { if (/captcha|is off/.test(e.message)) throw e; await new Promise((ok) => setTimeout(ok, 2000)); return readOnce(o); }
}
async function readOnce({ q, pageId, country = 'ALL', timeout = 45e3 } = {}) {
  if (process.env.AI_MOCK === '1' || process.env.ADLIB_OFF === '1') throw new Error('ad library reader is off');
  const cc = String(country || 'ALL').toUpperCase();
  const url = pageId
    ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${cc}&view_all_page_id=${encodeURIComponent(pageId)}&search_type=page&media_type=all`
    : `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${cc}&q=${encodeURIComponent(q)}&search_type=keyword_unordered&media_type=all`;
  await slot();
  let page = null;
  try {
    const b = await browser(); page = await b.newPage();
    await page.setUserAgent(UA); await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    let conn = null;
    // Facebook may redirect once after load (locale, consent): a read during it throws, so wait and read again
    for (let k = 0; k < 10 && !conn; k++) { const html = await page.content().catch(() => ''); conn = html ? connectionOf(html) : null; if (!conn) await new Promise((ok) => setTimeout(ok, 1500)); }
    if (!conn) { const html = await page.content().catch(() => ''); if (/captcha|checkpoint/i.test(html) && /xfb_ad_library_is_captcha_required":true/.test(html)) throw new Error('ad library asked for a captcha'); throw new Error('ad library page had no results block'); }
    const results = (conn.edges || []).flatMap((e) => e?.node?.collated_results || []).map((a) => ({ ...a, page_name: String(a.page_name || a.snapshot?.page_name || '').trim() || null }));
    return { results, searchResults: results, searchResultsCount: conn.count ?? results.length, source: 'adlib' };
  } finally { await page?.close().catch(() => {}); release(); }
}

/** One brand's live ads: { pageId } reads that page; { name } finds the page by keyword (loose name match), then
 *  reads the page itself so the count is the page's own total, not one page of keyword results. */
export async function companyAds({ name, pageId, country = 'ALL' } = {}) {
  if (pageId) return adLibrary({ pageId, country });
  const sq = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = sq(name);
  const j = await adLibrary({ q: name, country });
  const hit = j.results.find((a) => sq(a.page_name) === want) || j.results.find((a) => sq(a.page_name).startsWith(want) && sq(a.page_name).length - want.length <= 2);
  if (!hit?.page_id) return { ...j, results: [], searchResults: [], searchResultsCount: 0 };
  const k = await adLibrary({ pageId: hit.page_id, country });
  const results = k.results.filter((a) => String(a.page_id) === String(hit.page_id));
  return { results, searchResults: results, searchResultsCount: k.searchResultsCount || results.length, source: 'adlib' };
}

/** The Ad Library through treg, falling back to the free page reader whenever treg fails (402, outage, off).
 *  Same answer shapes as the ScrapeCreators endpoints. Every Ad Library caller in the feed goes through this. */
export async function adCall(treg, id, o = {}) {
  let err = null;
  if (treg && treg.live !== false) { try { return await treg.call(id, o); } catch (e) { err = e; } }
  const q = o.query || {};
  try {
    if (/company-ads/.test(id)) return await companyAds({ name: q.companyName, pageId: q.pageId, country: q.country });
    if (/search-companies/.test(id)) { const j = await adLibrary({ q: q.query, country: q.country || 'ALL' }); const by = new Map(); j.results.forEach((a) => a.page_id && !by.has(a.page_id) && by.set(a.page_id, { page_id: a.page_id, name: a.page_name, page_profile_uri: a.snapshot?.page_profile_uri || null })); return { searchResults: [...by.values()], source: 'adlib' }; }
    if (/search-ads/.test(id)) return await adLibrary({ q: q.query, country: q.country || 'ALL' });
  } catch (e) { throw new Error(`Ad Library unreachable: ${e.message}${err ? ` (treg: ${String(err.message).slice(0, 80)})` : ''}`); }
  throw err || new Error(`no fallback for ${id}`);
}
