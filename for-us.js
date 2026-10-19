// "For us": the one line every rival and news story slide ends on (QA FEED-ARV-10, FEED-NOT-07), when the story has no written
// take: what it means for the brand and the one thing to do, read from the story itself. Pure: no AI, no reads.
const RULES = [
  [/\b(rais\w*|funding|funded|valuation|investors?|series [a-e]|crore round|million round|ipo)\b/i, (b) => `A rival with fresh money will spend more on ads soon. Make clear now what ${b} does better.`],
  [/\b(launch\w*|unveil\w*|introduc\w*|new (?:range|line|product|collection))\b/i, (b) => `Shoppers will compare this launch with ${b}. Say plainly why ${b}'s is the one to pick.`],
  [/\b(price|prices|pricing|discount\w*|sale|cheaper|offer|deal)\b/i, (b) => `Shoppers will compare prices. Show what ${b}'s price gets them.`],
  [/\b(ban\w*|regulat\w*|rules?|law|compliance|recall\w*|fda|fssai|cdsco|asci|warning)\b/i, (b) => `Check that ${b}'s claims and labels still hold before anyone asks.`],
  [/\b(acquir\w*|acquisition|merger|buys|bought|stake)\b/i, (b) => `A bigger player is moving in. Keep ${b}'s loyal buyers close with a reason to stay.`],
  [/\b(trend\w*|demand|growing|growth|surge|rising|popular)\b/i, (b) => `Demand is moving. Put ${b}'s product in front of it with one ad or post.`]
];
export const newsForUs = (s = {}, brand = 'us') => { const text = `${s.h || ''} ${s.p || ''}`; const r = RULES.find(([re]) => re.test(text)); return r ? r[1](brand) : `Turn this into one idea for ${brand}'s next ad or page.`; };
export const adForUs = (a = {}, brand = 'us') => `Try ${a.brand ? `${a.brand}'s` : 'the same'} angle${a.format === 'video' ? ' as a video' : ''} with ${brand}'s own product and words.`;
