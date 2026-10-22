// Who is acting on a workspace, decided per request and never by a flag left on the shared workspace object.
// A workspace (tenant) id travels in share and handoff links, so a stored t.member would let any link holder act as the
// brand's team. Here t.member and t.memberEmail are getters:
//   - inside a request (REQ.run(who, ...)): that request's signed-in viewer, checked by the server from the session cookie
//   - on the background clock (no request): the last team member who opened the workspace (t.teamEmail), re-checked
//     against the brand's members before each tick (bgCheck); a person removed from the team stops it acting
// Assigning t.member does nothing, so old code paths that set it cannot grant anything.
// The team's live state on a workspace (t.liveLedger, t.liveConn, t.privMoves, t.privStatics, t.claimed) is per request too:
// what applyLive read for this viewer stays with this request, so a visitor's request never sees the team's real numbers
// left by the request before, and a member's request never loses them to a visitor's. Off a request (the background clock)
// it is what the background's own refresh read. None of it is saved with the workspace.
import { AsyncLocalStorage } from 'node:async_hooks';

export function createMemberCtx({ isMemberEmail = null, defaultBrand = 'brew-sample', memoMs = 5 * 60e3 } = {}) {
  const REQ = new AsyncLocalStorage(), BG = new WeakMap(), MEMO = new Map(), BG_LIVE = new WeakMap();
  const LIVE = { liveLedger: () => ({}), liveConn: () => ({}), privMoves: () => [], privStatics: () => false, claimed: () => false };
  const liveBox = (t, make = false) => { const s = REQ.getStore(); if (s) { if (!s.live && make) s.live = new WeakMap(); const m = s.live; if (!m) return null; if (!m.has(t) && make) m.set(t, {}); return m.get(t) || null; }
    if (!BG_LIVE.has(t) && make) BG_LIVE.set(t, {}); return BG_LIVE.get(t) || null; };
  const slugOf = (t) => t.brandId || defaultBrand;
  // this request's viewer for this workspace: a viewer of another brand is never a member here
  const reqOf = (t) => { const r = REQ.getStore(); return r ? (r.member && r.slug === slugOf(t) ? r : { member: false, email: null, guest: r.guest && r.slug === slugOf(t) ? r.guest : null }) : null; };
  const guard = (t) => {
    if (!t || typeof t !== 'object' || Object.getOwnPropertyDescriptor(t, 'member')?.get) return t;
    delete t.member; delete t.memberEmail;
    Object.defineProperty(t, 'member', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r ? !!r.member : !!BG.get(t); }, set() {} });
    /* the views this request's viewer may use (null = all): visitors, owners and the background clock are never limited */
    if (!Object.getOwnPropertyDescriptor(t, 'seats')?.get) Object.defineProperty(t, 'seats', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r && r.member && Array.isArray(r.seats) ? r.seats : null; }, set() {} });
    Object.defineProperty(t, 'memberEmail', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r ? r.email || null : BG.get(t) ? t.teamEmail || null : null; }, set() {} });
    /* a workspace saved before this kept the team's numbers on itself: they go (the next applyLive reads them again, per viewer) */
    for (const [k, dflt] of Object.entries(LIVE)) { delete t[k];
      Object.defineProperty(t, k, { configurable: true, enumerable: false, get() { const b = liveBox(t); return b && k in b ? b[k] : dflt(); }, set(v) { liveBox(t, true)[k] = v; } }); }
    return t;
  };
  // the background clock: is the workspace's last team member still on the team (cached a few minutes)
  const bgCheck = async (t) => {
    const e = t.teamEmail; let v = false;
    if (e && isMemberEmail) { const k = `${slugOf(t)}|${e}`, c = MEMO.get(k); if (c && Date.now() - c.at < memoMs) v = c.v; else { v = !!(await isMemberEmail(slugOf(t), e).catch(() => false)); MEMO.set(k, { at: Date.now(), v }); } }
    BG.set(t, v); return v;
  };
  // a request: who = { member, email, claimed, slug } from the signed-in user; a member who opens it becomes the one bgCheck re-checks
  const run = (who, t, fn) => { if (t && who?.member && who.email && who.slug === slugOf(t) && t.teamEmail !== who.email) t.teamEmail = who.email; return REQ.run(who, fn); };
  return { REQ, guard, reqOf, bgCheck, run, bgMember: (t) => !!BG.get(t), forget: () => MEMO.clear() };
}
