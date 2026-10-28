/* The words behind every tooltip, in one place: one short sentence each, in plain words (plain.js style), the same for every
   brand and every card. A button or label carries them as data-tip; the floating #tipx layer (app.js) shows them on hover,
   keyboard focus or a long press. test/tips.test.js keeps them short, single sentences and free of jargon and brand names. */
(function () {
  const T = {
    /* the feed card */
    heart: 'Show me more cards like this one.',
    jam: 'Open a jam to plan this with your team.',
    proof: 'Why we suggest this card, and the facts behind it.',
    take: 'Another take: a new free draft of this picture.',
    save: 'Keep this card to come back to later.',
    cardMore: 'More things you can do with this card.',
    from: 'Where the idea for this card comes from.',
    story: 'Today’s updates for you; each story lasts a day.',
    firstDraft: 'A free first draft to react to, not the finished piece.',
    newPic: 'A fresh picture is on its way; this one stands in until it lands.',
    ourPick: 'The way we would go, from what we know about your store.',
    /* the jam stage */
    steps: 'Draft the words, make the picture or video, then send it to your team.',
    stepsNoMake: 'Draft the words, then send the brief to your team.',
    redo: 'A new take from a fresh angle, free; this one stays in History.',
    redoPaid: 'Made again with the same set-up at the price shown; this one stays in History.',
    credits: 'Credits pay for the finished piece; drafts are always free.',
    gemini: 'Our main maker isn’t ready, so we make this one with Gemini.',
    simulated: 'Simulated on this site, so no credits are spent.',
    free: 'Drafts cost nothing; only the finished piece uses credits.',
    price: 'What this costs to make, shown before you tap.',
    grade: 'Grades run A to D: A is a fair test against a held-back group, D is a simple before-and-after.',
    link: 'Copy the link to this jam.',
    share: 'Send this jam to WhatsApp, Slack or as a link.',
    pieceMore: 'More things you can do with this piece.',
    attach: 'Add a file, photo or link for us to read.',
    mic: 'Talk instead of typing.',
    /* the Work board */
    colMore: 'Options for this column.',
    /* the Brand Book */
    bbRemove: 'Take this out of your Brand Book.',
    bbCopy: 'Copy this colour code.',
    bbUndo: 'Go back to what we read from your site.',
    bbRuleOff: 'Turn this rule off.',
    bbBlock: 'This rule stops the work; tap to only warn.',
    bbWarn: 'This rule only warns; tap to make it stop the work.',
    /* the feed's areas: what each word on a card, a Deck column or a health ring means */
    area_signals: 'Signals are what your customers do and say: orders, reviews, messages and searches.',
    area_catalog: 'Catalog is your products: names, photos, prices and stock.',
    area_creatives: 'Creatives are the pictures, videos and words in your ads and posts.',
    area_ads: 'Ads are your paid campaigns: what they cost, what they bring and what to change.',
    area_storefront: 'Storefront is your website: its pages, checkout and what makes people buy.',
    area_visibility: 'AI answers is how ChatGPT and other AI tools talk about you when people ask.'
  };
  /* an area by its key (a card's sector, a Deck column) or by the name a health ring shows */
  const AREA_NAME = { creative: 'creatives', storefront: 'storefront', 'ai answers': 'visibility', signals: 'signals', catalog: 'catalog', creatives: 'creatives', ads: 'ads' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /* ` data-tip="…"` for a key (or words of its own), ready to drop into a tag; nothing when there are no words */
  /* partner mode (make-mode.js): no price is shown to anyone, so the tips that talk about prices or credits say what the button does */
  const NO_PRICE = { redoPaid: 'Made again with the same set-up; this one stays in History.', credits: 'Makes the finished piece.', free: 'A quick draft to check the idea.', price: '', simulated: 'Simulated on this site.' };
  for (const [k, v] of Object.entries(NO_PRICE)) { const paid = T[k]; Object.defineProperty(T, k, { enumerable: true, configurable: true, get: () => (typeof window !== 'undefined' && window.LIVE?.makeMode === 'partner' ? v : paid) }); }
  const attr = (k) => { const t = T[k] || (k && !/^[a-z][A-Za-z]*$/.test(k) ? k : ''); return t ? ` data-tip="${esc(t)}"` : ''; };
  const area = (k) => { const key = AREA_NAME[String(k || '').toLowerCase()] || k; return T[`area_${key}`] ? attr(`area_${key}`) : ''; };
  if (typeof window !== 'undefined') window.BrewTips = { T, attr, area };
  if (typeof module !== 'undefined') module.exports = { T, attr, area };
})();
