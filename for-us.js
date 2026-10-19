// "For us": the one line every rival and news story slide ends on (QA FEED-ARV-10, FEED-NOT-07), when the story has no written
// take: what it means for the brand and the one thing to do, read from the story itself. Pure: no AI, no reads.
/* ad-platform news (Google Ads budget controls, a Meta ads feature): a change in where the brand's ads run, not a rival's launch */
const AD_PLATFORM = /\b(?:google ads|meta ads|facebook ads|instagram ads|tiktok ads|youtube ads|amazon ads|performance max|pmax|advantage\+|ads manager)\b|\b(?:google|meta|facebook|instagram|tiktok|youtube|snapchat|pinterest)\b.{0,60}\b(?:ads?|advertis\w*|advertisers?|campaigns?|budgets?|bidding|targeting|audiences?|lifecycle|creatives?|ad tools?|controls)\b/i;
/* order matters: money and acquisitions before launches ("HUL eyes stake" is a stake, not a launch), ad platforms before launches ("Meta launches …" is an ad tool) */
const RULES = [
  [/\b(rais\w*|funding|funded|valuation|investors?|series [a-e]|crore round|million round|ipo)\b/i, (b) => `A rival with fresh money will spend more on ads soon. Make clear now what ${b} does better.`],
  [/\b(acquir\w*|acquisition|merger|buys|bought|stake)\b/i, (b) => `A bigger player is moving in. Keep ${b}'s loyal buyers close with a reason to stay.`],
  [AD_PLATFORM, (b) => `This changes how ${b}'s ads can run. Try it on one campaign first and compare what each sale costs.`, 'Start the tests'],
  [/\b(launch\w*|unveil\w*|introduc\w*|new (?:range|line|product|collection))\b/i, (b) => `Shoppers will compare this launch with ${b}. Say plainly why ${b}'s is the one to pick.`],
  [/\b(price|prices|pricing|discount\w*|sale|cheaper|offer|deal)\b/i, (b) => `Shoppers will compare prices. Show what ${b}'s price gets them.`],
  [/\b(ban\w*|regulat\w*|rules?|law|compliance|recall\w*|fda|fssai|cdsco|asci|warning)\b/i, (b) => `Check that ${b}'s claims and labels still hold before anyone asks.`],
  [/\b(trend\w*|demand|growing|growth|surge|rising|popular)\b/i, (b) => `Demand is moving. Put ${b}'s product in front of it with one ad or post.`]
];
/* the headline decides first; the paragraph only when the headline matches no rule (a story's body mentions launches and prices in passing) (final QA pass 19 Oct) */
const ruleOf = (s = {}) => RULES.find(([re]) => re.test(String(s.h || ''))) || RULES.find(([re]) => re.test(String(s.p || ''))) || null;
export const newsForUs = (s = {}, brand = 'us') => { const r = ruleOf(s); return r ? r[1](brand) : `Turn this into one idea for ${brand}'s next ad or page.`; };
/* the story's one button: ad-platform news starts a test, the rest becomes an idea */
export const newsCta = (s = {}) => ruleOf(s)?.[2] || 'Turn into an idea';
export const adForUs = (a = {}, brand = 'us') => `Try ${a.brand ? `${a.brand}'s` : 'the same'} angle${a.format === 'video' ? ' as a video' : ''} with ${brand}'s own product and words.`;
