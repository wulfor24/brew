// A static ad's card says what to do; its headline is already set in the picture, so the headline is never the card title too
// (QV 28 Oct: one ad read its headline in the image, again in the caption and again as the title). healStatic: a card saved
// before then with its headline as its title gets the same title, its headline kept beside it. One static per card ("static-<id>").
export const staticTitle = (product, brand) => `Run this ad for ${product || brand || 'your brand'}`.slice(0, 120);
export const healStatic = (c, brand = '') => { if (!c || !/^static-/.test(String(c.id || '')) || /^Run this ad for /.test(c.title || '')) return c;
  c.headline = c.headline || c.title; c.title = staticTitle(c.product, brand); return c; };
