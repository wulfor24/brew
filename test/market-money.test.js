// Feed audit #15 and moves audit 20 Oct: a brand with no saved country gets the one its own words keep naming (never for a market
// left to confirm), money with no known currency is never ₹, and SEO tools' dollars read in the brand's currency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countryFromText } from '../derive.js';
import { moneyFmt } from '../brand-pack.js';
import { usdText, usdDeep } from '../fx.js';

test('the country the brand names, only when it is a clear winner', () => {
  assert.equal(countryFromText('A Bangalore grocer. Bengaluru delivery. Bangalore homes, Bengaluru, India.'), 'IN');
  assert.equal(countryFromText('Fresno, California. California farms, California, California, the US... California'), 'US');
  assert.equal(countryFromText('Prague, Czech'), null);
  assert.equal(countryFromText('London London London London London Mumbai Mumbai Mumbai Mumbai'), null);
});
test('no currency, no rupee sign', () => { assert.equal(moneyFmt('')(1500), '1,500'); assert.equal(moneyFmt('INR')(1500), '₹1,500'); assert.equal(moneyFmt('EUR')(15), '€15'); });
test('dollar estimates read in the brand currency and keep where they came from; a book title stays', () => {
  assert.equal(usdText('cost per click: 0.3 USD', 'INR'), 'cost per click: about ₹26 (est. from US$0.3)');
  assert.equal(usdText('budget $380,600/mo', 'INR'), 'budget about ₹3.3 crore/mo (est. from US$380,600/mo)');
  assert.equal(usdText('In $100M Offers', 'INR'), 'In $100M Offers');
  assert.equal(usdText('$5', 'USD'), '$5'); assert.equal(usdText('$5', ''), '$5');
  assert.deepEqual(usdDeep({ url: 'https://x.com/$5', rows: [['$12']] }, 'GBP'), { url: 'https://x.com/$5', rows: [['about £9 (est. from US$12)']] });
});
