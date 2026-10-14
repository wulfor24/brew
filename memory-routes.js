// Brand memory routes (brand-memory.js). Registered from server.js.
//   GET    /api/brands/:slug/memory            the repo files, the facts and the change log (your own personal lines only)
//   GET    /api/brands/:slug/memory?q=...      search the memory
//   POST   /api/brands/:slug/memory            add a note { text, scope?: 'brand'|'member', topic?, source? }
//   DELETE /api/brands/:slug/memory/:id        forget one line
//   POST   /api/brands/:slug/memory/learn      read what is live (site, ads, posts, reviews) into memory
//   POST   /api/brands/:slug/memory/consolidate tidy it (merge duplicates, drop stale lines)
// Same rule as the other brand routes: a claimed brand is changed only by its team.
import { memberKey } from './brand-memory.js';

export function createMemoryRoutes({ memory, viewerOf, readBody, send, exists = async () => true, enabled = () => true }) {
  return async (req, res, u) => {
    const m = u.pathname.match(/^\/api\/brands\/([a-z0-9-]+)\/memory(?:\/(learn|consolidate|m_[a-f0-9]+))?$/); if (!m) return false;
    const [, slug, sub] = m;
    if (!enabled()) return send(res, 200, { error: 'Brand memory is off here.', off: true }), true;
    if (!(await exists(slug))) return send(res, 404, { error: 'unknown brand' }), true;
    const v = await viewerOf(req, slug), me = memberKey(v.email);
    const canWrite = !v.claimed || v.member;
    if (req.method === 'GET' && !sub) {
      const q = u.searchParams.get('q');
      if (q) return send(res, 200, { results: await memory.search(slug, q, { memberId: me, k: Math.min(+u.searchParams.get('k') || 8, 30) }) }), true;
      return send(res, 200, { ...(await memory.repo(slug, { memberId: me })), you: me, canWrite }), true;
    }
    if (!canWrite) return send(res, 403, { error: 'Only this brand’s team can change its memory. Ask them for access.', team: true }), true;
    if (req.method === 'POST' && !sub) {
      const b = await readBody(req); const text = String(b.text || '').trim().slice(0, 4000);
      if (text.length < 4) return send(res, 200, { error: 'Write the note first.' }), true;
      const scope = b.scope === 'member' ? 'member' : 'brand';
      if (scope === 'member' && !me) return send(res, 200, { error: 'Sign in to keep personal preferences.' }), true;
      const by = v.email ? `team member ${me}` : 'a teammate';
      const r = await memory.add(slug, text, { scope, memberId: me, topic: b.topic || undefined, source: { kind: 'note', label: String(b.source || `note from ${by}`).slice(0, 140) }, by });
      return send(res, 200, { ok: true, added: r.added, updated: r.updated, deleted: r.deleted, confirmed: r.same.length }), true;
    }
    if (req.method === 'DELETE' && sub?.startsWith('m_')) return send(res, 200, await memory.forget(slug, sub, { by: v.email ? `team member ${me}` : 'a teammate', memberId: me })), true;
    if (req.method === 'POST' && sub === 'learn') return send(res, 200, await memory.learnFromLive(slug)), true;
    if (req.method === 'POST' && sub === 'consolidate') return send(res, 200, await memory.consolidate(slug)), true;
    return send(res, 404, { error: 'not found' }), true;
  };
}
