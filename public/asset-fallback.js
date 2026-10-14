// A picture never shows as a broken box with its alt text. app.js calls onError for every <img> or <video> that fails:
//   1. our own file (gen/, research/, b/<slug>/a/, b/<slug>/statics/) is asked for once more after a moment: the file may
//      still be on its way to the bucket from the instance that made it, or this instance is fetching it;
//   2. then the element's fallback list (data-fb, "a|b|c": the real product photo a draft was made from, the card's photo);
//      a clip that can't play becomes its poster picture;
//   3. then 'dead': app.js shows its empty state for a generated creative, and quiet() anything else (a soft surface in a
//      media box, an invisible image elsewhere), never the alt text.
// Plain script (window.BrewAsset); also loads in node for the tests (globalThis.BrewAsset).
(function (root) {
  const OWN = /^\/?(gen|research|b\/[a-z0-9-]+\/(a|statics))\//i;
  const base = (u) => String(u || '').replace(/([?&])r=[a-z0-9]+$/i, '').replace(/[?&]$/, '');
  const fbOf = (el) => String(el.dataset.fb || '').split('|').map((x) => x.trim()).filter(Boolean);
  function onError(el, { later = (f) => f(), doc = root.document } = {}) {
    if (!el || !el.dataset) return 'dead';
    const src = base(el.getAttribute('src'));
    if (!el.dataset.src0) el.dataset.src0 = src;
    if (src && !el.dataset.retried && OWN.test(src)) {
      el.dataset.retried = '1';
      later(() => el.setAttribute('src', `${src}${src.includes('?') ? '&' : '?'}r=${Date.now().toString(36)}`));
      return 'retry';
    }
    const fb = fbOf(el).filter((x) => x !== src && x !== el.dataset.src0);
    if (el.tagName === 'VIDEO') {
      const pic = el.getAttribute('poster') || fb.shift(); if (!pic || !doc) return 'dead';
      const im = doc.createElement('img'); im.setAttribute('src', pic); im.setAttribute('alt', ''); im.className = 'fd-v';
      if (fb.length) im.dataset.fb = fb.filter((x) => x !== pic).join('|');
      el.replaceWith(im); return 'poster';
    }
    if (fb.length) { el.dataset.fb = fb.slice(1).join('|'); delete el.dataset.retried; el.setAttribute('alt', ''); el.setAttribute('src', fb[0]); return 'fallback'; }
    return 'dead';
  }
  // nothing left to show: in a media box a soft empty surface the size of the picture; anywhere else the image just goes quiet
  function quiet(el, { doc = root.document } = {}) {
    el.setAttribute('alt', '');
    if (doc && el.closest?.('.media, .fd, .cv-slides, .cv-media, .jm-dr-sl, .st-media, .story, .sl')) { const ph = doc.createElement('div'); ph.className = 'img-dead'; ph.dataset.src = el.dataset.src0 || ''; el.replaceWith(ph); return 'placeholder'; }
    el.style.visibility = 'hidden'; return 'hidden';
  }
  root.BrewAsset = { onError, quiet, OWN };
})(typeof window !== 'undefined' ? window : globalThis);
