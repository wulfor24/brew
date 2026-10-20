/* Copy and open: a ready post for Reddit, Quora, X, LinkedIn, Pinterest, a Facebook group or a comment thread is copied and the
   exact place opens in a new tab, filled in where the platform allows it (a new Reddit post, X, LinkedIn, Pinterest). The team
   pastes and posts; Brew never posts in a community on anyone's behalf (SCOPE.md). Pure: of(change) → { label, url, text,
   filled, rule } or null; the jam's ship bar shows it and app.js rxAct('post-open') runs it. */
(function (root) {
  const NAME = { x_post: 'X', reddit_post: 'Reddit', linkedin_post: 'LinkedIn', quora_answer: 'Quora', fb_group_post: 'the group', pinterest_pin: 'Pinterest', comment_reply: 'the thread' };
  const kindOf = (ch, p) => { const a = String(ch?.action || '').split('.').pop(), pl = String(p.platform || '');
    if (NAME[a]) return a;
    return /\b(x|twitter)\b/i.test(pl) ? 'x_post' : /reddit/i.test(pl) ? 'reddit_post' : /linkedin/i.test(pl) ? 'linkedin_post' : /quora/i.test(pl) ? 'quora_answer' : /facebook/i.test(pl) ? 'fb_group_post' : /pinterest/i.test(pl) ? 'pinterest_pin' : null; };
  const http = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const enc = encodeURIComponent;
  const subOf = (w) => { const m = /\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/.exec(w?.url || '') || /^r\/([A-Za-z0-9_]{2,21})\b/i.exec(String(w?.name || '').trim()); return m ? m[1] : ''; };
  const isThread = (w) => w?.kind === 'thread' || /\/comments\//.test(w?.url || '');
  /* the X copy: a thread's posts are split by a blank line and "2/" style numbers (app.js pmThread) */
  const xPosts = (copy) => { const parts = String(copy || '').trim().split(/\n\s*\n(?=\s*\d{1,2}\s*[/.)]\s)/); return parts.length > 1 ? parts.map((x) => x.replace(/^\s*\d{1,2}\s*[/.)]\s*/, '').trim()) : [String(copy || '').trim()]; };

  function of(ch, { brandUrl = '', image = '' } = {}) {
    const p = ch?.pkg || {}; if (ch?.family !== 'post' || ch?.target?.conn === 'meta') return null;
    const kind = kindOf(ch, p); if (!kind) return null;
    const copy = String(p.copy || '').trim(); if (!copy) return null;
    const tags = (p.hashtags || []).filter((t) => t && !copy.toLowerCase().includes(String(t).toLowerCase()));
    const body = tags.length ? `${copy}\n\n${tags.join(' ')}` : copy;
    const where = (p.where || []).filter((w) => w && (w.name || w.url)), w0 = where.find((w) => http(w.url)) || null;
    const rule = where.map((w) => w.rule).find(Boolean) || '';
    const out = (label, url, text, filled) => (url ? { kind, label, url, text, filled, rule } : null);
    if (kind === 'reddit_post') {
      const thread = where.find((w) => isThread(w) && http(w.url));
      const reply = !p.title || /reply|comment/i.test(String(p.format || '')) || (!!thread && !where.some((w) => w.kind === 'community'));
      if (reply) return thread ? out('Copy and open the thread', thread.url, body, false) : w0 ? out('Copy and open Reddit', w0.url, body, false) : null;
      const sub = where.map(subOf).find(Boolean);
      const url = `https://www.reddit.com/${sub ? `r/${sub}/` : ''}submit?type=TEXT&title=${enc(String(p.title).slice(0, 300))}&text=${enc(body.slice(0, 6000))}`;
      return out(sub ? `Open r/${sub} to post` : 'Open Reddit to post', url, body, true);
    }
    if (kind === 'x_post') { const posts = xPosts(copy); if (tags.length) posts[posts.length - 1] += `\n\n${tags.join(' ')}`;
      return out('Open X to post', `https://x.com/intent/post?text=${enc(posts[0].slice(0, 1000))}`, posts.join('\n\n'), true); }
    if (kind === 'linkedin_post') return out('Open LinkedIn to post', `https://www.linkedin.com/feed/?shareActive=true&text=${enc(body.slice(0, 3000))}`, body, true);
    if (kind === 'pinterest_pin') { const img = http(image), site = http(brandUrl);
      if (img && site) return out('Open Pinterest to pin', `https://www.pinterest.com/pin/create/button/?url=${enc(site)}&media=${enc(img)}&description=${enc([p.title, body].filter(Boolean).join('\n\n').slice(0, 500))}`, body, true);
      return out('Copy and open Pinterest', 'https://www.pinterest.com/pin-builder/', body, false); }
    if (kind === 'quora_answer') return w0 ? out('Copy and open the question', w0.url, body, false) : null;
    if (kind === 'fb_group_post') return w0 ? out('Copy and open the group', w0.url, body, false) : null;
    return w0 ? out('Copy and open the thread', w0.url, body, false) : null; // a comment reply: the video or post it answers
  }
  /* what the toast says after the tab opens */
  const said = (o) => o.filled ? `Copied too. Check it in the new tab and post.${o.rule ? ` ${o.rule}` : ''}` : `Copied. Paste it in the new tab and post.${o.rule ? ` ${o.rule}` : ''}`;
  root.PostOpen = { of, said, kindOf };
})(typeof window !== 'undefined' ? window : globalThis);
