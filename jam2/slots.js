// Pick a day: the brand's best posting slots from its own dated Instagram posts, in the brand's own time zone.
// A post read with a date only (no time) says nothing about the hour, so those give best days, never a made-up time.
const TZ = { IN: ['Asia/Kolkata', 'India time'], US: ['America/New_York', 'US Eastern time'], CA: ['America/Toronto', 'Eastern time'], GB: ['Europe/London', 'UK time'], UK: ['Europe/London', 'UK time'],
  AU: ['Australia/Sydney', 'Sydney time'], AE: ['Asia/Dubai', 'UAE time'], SG: ['Asia/Singapore', 'Singapore time'], DE: ['Europe/Berlin', 'Central European time'], FR: ['Europe/Paris', 'Central European time'] };

const timeOf = (x) => { const v = x.at ?? x.ts ?? x.timestamp ?? x.taken_at ?? x.date ?? '';
  if (typeof v === 'number') return { ms: v < 1e12 ? v * 1000 : v, timed: true };
  const s = String(v).trim(), ms = Date.parse(s); return { ms, timed: /\d[T ]\d{1,2}:\d{2}/.test(s) }; };

export function bestSlots(rawPosts, country) {
  const [tz, tzName] = TZ[String(country || '').toUpperCase()] || ['UTC', 'UTC'];
  const posts = (rawPosts || []).map((x) => ({ ...timeOf(x), score: +(x.likes || x.likesCount || 0) + 3 * +(x.comments || x.commentsCount || 0) })).filter((x) => Number.isFinite(x.ms));
  if (posts.length < 8) return { slots: [], basis: posts.length ? `Only ${posts.length} dated posts were read; Brew needs at least 8 to suggest a time.` : 'Brew has no dated posts from your Instagram yet, so it can’t suggest a time. Pick a day yourself.' };
  const timed = posts.filter((x) => x.timed), byHour = timed.length >= 8, use = byHour ? timed : posts;
  const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', timeZone: byHour ? tz : 'UTC' });
  const key = (ms) => byHour ? `${day(ms)}|${Math.floor(+new Date(ms).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }) % 24 / 3) * 3}` : `${day(ms)}|`;
  const g = {}; for (const x of use) (g[key(x.ms)] ||= []).push(x.score);
  const top = Object.entries(g).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ k, n: v.length, score: v.reduce((a, c) => a + c, 0) / v.length })).sort((a, c) => c.score - a.score).slice(0, 3);
  return { slots: top.map((x) => { const [d, h] = x.k.split('|'); return { day: d, from: h === '' ? null : +h, to: h === '' ? null : +h + 3, why: `${x.n} of your posts went up then, with the most likes and comments (${Math.round(x.score)} on average)` }; }),
    basis: byHour ? `From ${use.length} of your Instagram posts (${tzName}).` : `From ${use.length} of your Instagram posts. They were read with dates only, so these are your best days, not times.` };
}
