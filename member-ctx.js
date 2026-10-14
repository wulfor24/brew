// Who is acting on a workspace, decided per request and never by a flag left on the shared workspace object.
// A workspace (tenant) id travels in share and handoff links, so a stored t.member would let any link holder act as the
// brand's team. Here t.member and t.memberEmail are getters:
//   - inside a request (REQ.run(who, ...)): that request's signed-in viewer, checked by the server from the session cookie
//   - on the background clock (no request): the last team member who opened the workspace (t.teamEmail), re-checked
//     against the brand's members before each tick (bgCheck); a person removed from the team stops it acting
// Assigning t.member does nothing, so old code paths that set it cannot grant anything.
import { AsyncLocalStorage } from 'node:async_hooks';

export function createMemberCtx({ isMemberEmail = null, defaultBrand = 'brew-sample', memoMs = 5 * 60e3 } = {}) {
  const REQ = new AsyncLocalStorage(), BG = new WeakMap(), MEMO = new Map();
  const slugOf = (t) => t.brandId || defaultBrand;
  // this request's viewer for this workspace: a viewer of another brand is never a member here
  const reqOf = (t) => { const r = REQ.getStore(); return r ? (r.member && r.slug === slugOf(t) ? r : { member: false, email: null }) : null; };
  const guard = (t) => {
    if (!t || typeof t !== 'object' || Object.getOwnPropertyDescriptor(t, 'member')?.get) return t;
    delete t.member; delete t.memberEmail;
    Object.defineProperty(t, 'member', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r ? !!r.member : !!BG.get(t); }, set() {} });
    /* the views this request's viewer may use (null = all): visitors, owners and the background clock are never limited */
    if (!Object.getOwnPropertyDescriptor(t, 'seats')?.get) Object.defineProperty(t, 'seats', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r && r.member && Array.isArray(r.seats) ? r.seats : null; }, set() {} });
    Object.defineProperty(t, 'memberEmail', { configurable: true, enumerable: false, get() { const r = reqOf(t); return r ? r.email || null : BG.get(t) ? t.teamEmail || null : null; }, set() {} });
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
  return { REQ, guard, reqOf, bgCheck, run, forget: () => MEMO.clear() };
}
