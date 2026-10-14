// Which brand is this code running for? Every request, watcher tick and background job runs inside
// runIn(brand, fn); AsyncLocalStorage carries it through awaits and timers. Module code reads brand data
// through live views (B(), live(), liveRe()), so the v1 code keeps its shape (SEED.posts, FACTS[k],
// RIVALS.test(x)) and each call sees the active brand's pack. Outside any context: the default brand.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
let fallback = null;
export const setDefaultBrand = (b) => { fallback = b; };
export const B = () => als.getStore() || fallback;
// the brand this code is running for, or null outside a brand context (no default brand)
export const inBrand = () => als.getStore() || null;
export const runIn = (b, fn) => (b ? als.run(b, fn) : fn());
export const brandSlug = () => B()?.slug || null;

// a live object view: live((b) => b.seed) behaves like the active brand's seed
export const live = (pick) => {
  const o = () => pick(B()) || {};
  return new Proxy({}, {
    get: (_, k) => { const t = o(); const v = t[k]; return typeof v === 'function' && !(k in Object.prototype) ? v.bind(t) : v; },
    set: (_, k, v) => { o()[k] = v; return true; },
    has: (_, k) => k in o(),
    deleteProperty: (_, k) => delete o()[k],
    ownKeys: () => Reflect.ownKeys(o()),
    getOwnPropertyDescriptor: (_, k) => { const t = o(); return k in t ? { value: t[k], enumerable: true, configurable: true, writable: true } : undefined; }
  });
};
// a live array view (Proxy over [] so Array.isArray, spread and .map work)
export const liveArr = (pick) => {
  const o = () => pick(B()) || [];
  return new Proxy([], {
    get: (_, k) => { const t = o(); const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; },
    has: (_, k) => k in o(),
    ownKeys: () => Reflect.ownKeys(o()),
    getOwnPropertyDescriptor: (_, k) => Reflect.getOwnPropertyDescriptor(o(), k)
  });
};
// a live regex: .test/.exec plus use in String#replace/match/split via the well-known symbols
export const liveRe = (pick) => {
  const r = () => { const x = pick(B()); return x instanceof RegExp ? x : /(?!)/; };
  return {
    test: (s) => { const x = r(); x.lastIndex = 0; return x.test(s); },
    exec: (s) => r().exec(s),
    get source() { return r().source; }, get flags() { return r().flags; },
    [Symbol.replace]: (s, rep) => String(s).replace(r(), rep),
    [Symbol.match]: (s) => String(s).match(r()),
    [Symbol.split]: (s, lim) => String(s).split(r(), lim),
    [Symbol.search]: (s) => String(s).search(r())
  };
};
// a value that is read per call
export const liveVal = (pick) => () => pick(B());
// short reads used inside prompts and copy
export const BN = () => B()?.name || 'the brand';
export const BH = () => B()?.host || '';
export const CTRY = () => B()?.config?.countryName || 'your market';
export const FESTN = () => B()?.config?.festival?.name || 'the next sale';
export const FESTD = () => B()?.config?.festival?.label || 'soon';
