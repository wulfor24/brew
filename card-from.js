// Where a card came from, in plain words, for the line at the top of every feed card ("From AI answers", "Asked on Reddit").
// It is worked out from what the card really rests on, never from the internal routing fields (agent, sector), which name the
// team that handles a card, not its source: a Reddit question was routed to the AI answers team and read "From AI answers", and
// a pack-price fix routed to signals read "From your customers" (Param, 20 Oct). A move card says the discipline of the move it
// came from (moves.json skill, group and kicker); a listening card says where it was heard; what the team told Brew says so.
// feed-service pub() stamps card.from on every card it serves, so saved cards heal on the next load; public/app.js fromLabel
// reads card.from first and keeps its own fallbacks for cards built in the page.

/* a move's discipline → where its cards came from (every skill in moves-engine.js and moves-cadence.js) */
export const FROM_SKILL = {
  'ai-seo': 'From AI answers',
  'seo-audit': 'From Google search', schema: 'From Google search', 'programmatic-seo': 'From Google search', 'site-architecture': 'From Google search',
  'content-strategy': 'Content that gets found', 'directory-submissions': 'Getting listed', 'public-relations': 'Press and media',
  competitors: 'From your competitors', 'competitor-profiling': 'From your competitors',
  cro: 'From your store', popups: 'From your store', signup: 'From your store', paywalls: 'From your store', 'free-tools': 'From your store',
  'lead-magnets': 'From your store', 'ab-testing': 'Testing what works', copywriting: 'Your words', 'copy-editing': 'Your words',
  aso: 'Marketplace listings',
  ads: 'From your ads', 'ad-creative': 'For your ads', image: 'For your ads', video: 'For your ads',
  social: 'For your socials', 'influencer-marketing': 'Creators', 'co-marketing': 'Partnerships', events: 'Events', launch: 'Launches',
  'seasonal-planning': 'Coming up on the calendar',
  emails: 'Customer messages', sms: 'Customer messages', 'churn-prevention': 'Keeping customers', onboarding: 'Keeping customers',
  referrals: 'Referrals and reviews', 'community-marketing': 'Communities', 'marketing-loops': 'Growth loops',
  'customer-research': 'From your customers', 'community-research': 'Ask the community',
  'product-marketing': 'Your positioning', pricing: 'Prices and offers', offers: 'Prices and offers',
  analytics: 'Measuring what works', attribution: 'Measuring what works',
  'marketing-plan': 'Your marketing plan', 'marketing-council': 'Your marketing plan', 'marketing-psychology': 'Why people buy',
  'marketing-ideas': 'New idea for you',
  'cold-email': 'Selling to businesses', prospecting: 'Selling to businesses', 'sales-enablement': 'Selling to businesses', revops: 'Selling to businesses'
};
/* a move family that says more than its skill: the team's own words, listening, routines, the weather */
const FROM_GROUP = { learn: 'From your team', listen: 'Heard online', auto: 'Saves you time' };
const FROM_KICKER = [[/^WEATHER/, 'From the weather'], [/^SEARCH DEMAND/, 'From Google search'], [/^ALWAYS-ON/, 'Saves you time'], [/FROM LISTENING|^COMPLAINT FIX|^ASK THE COMMUNITY|^WHAT THE COMMUNITY SAID/, 'Heard online'], [/^SWITCH FROM RIVALS/, 'From your competitors']];

export function moveFrom(mv) {
  if (!mv || typeof mv !== 'object') return null;
  if (FROM_GROUP[mv.group]) return FROM_GROUP[mv.group];
  const k = String(mv.kicker || '').toUpperCase(), hit = FROM_KICKER.find(([re]) => re.test(k));
  if (hit) return hit[1];
  return FROM_SKILL[mv.skill] || null;
}

const PLATFORM = { reddit: 'Reddit', youtube: 'YouTube', quora: 'Quora', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', twitter: 'X', facebook: 'Facebook' };
/* the move a card came from: m11-2, m1001-1-p (a private rewrite of move 1001) */
export const moveNumOf = (c) => { const m = /^m(\d+)-\d+(?:-p)?$/.exec(String(c?.id || '')); return m ? +m[1] : null; };

/* the plain "from" line for one card, or null when the card itself says nothing about its source (the page falls back) */
export function cardFrom(c, moves = {}) {
  if (!c || typeof c !== 'object') return null;
  if (c.origin === 'told' || c.moveFamily === 'learn') return 'From your team';
  if (c.stream === 'heard' || c.origin === 'listen') {
    if (c.heard?.kind === 'thread') { const p = PLATFORM[String(c.post?.platform || '').toLowerCase()]; return p ? `Asked on ${p}` : 'Asked online'; }
    return 'Heard online';
  }
  if (c.origin === 'ideas') return 'New idea for you';
  if (c.origin === 'build') return c.campaign ? null : 'From Brew'; // "All 56 moves are written" is Brew's own news; the ad plan keeps its campaign line
  const n = moveNumOf(c);
  if (n != null) return moveFrom(moves?.[n] || moves?.[String(n)]);
  return null;
}
