// First drafts in a jam, one tap away. AI reads the jam's brief and makes the asset it asks for, in the form it
// needs: an image (the brand's real product photo in a new scene), a short video (that image animated), a voice
// line, or plain text (ad copy, a WhatsApp message, an email, page copy). Nothing is made until someone taps:
// a draft costs money, so it is never made for a card nobody opened.
// Each draft lives on the jam (w.drafts), newest first; the client polls the jam while one is being made.
import { CLAIMS_RULE, COPY_RULE, cleanDraftClaims } from './claims.js'; // no invented codes, guarantees or timed results; copy that reads right
import { budgetWhy } from './budget.js'; // whose daily share ran out, in plain words
import { makeVoice as vertexVoice, makeVideo as vertexVideo } from './media.js'; // Vertex, then OpenAI (media.js); Sloosh makes finals only
import { buildDraft } from './sloosh-prompt.js'; // one brief for drafts and finals
import { matchProduct, cardProduct, sceneOf } from './product-match.js';
import crypto from 'node:crypto';
import { safeFetch } from './reader/util.js'; // photo links reach only the public internet
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { saveGen, genFile } from './gen-store.js';
import { memoryBlockAsync } from './learn.js'; // brand memory (brand-memory.js), '' when off
import { isRivalCard, isResearchImage, readRivalAd, rivalBlock, rivalPicture } from './rival-ad.js'; // a rival's ad remade in its style

export const DRAFT_AS = ['image', 'carousel', 'video', 'voice', 'text'];
const VOICES = ['Kore', 'Aoede', 'Leda', 'Charon', 'Puck', 'Orus'];
const RATIOS = ['1:1', '4:5', '9:16', '16:9'];
const MAX_KEEP = 12;

const SCHEMA = {
  type: 'object', required: ['as', 'title', 'copy'], properties: {
    as: { type: 'string', enum: DRAFT_AS, description: 'The form the brief needs: image for a single static ad or post, carousel for a swipeable carousel (ad or post) or a set of Stories, video for a reel or video ad, voice for a voice note, voiceover or radio-style spot, text for copy that ships as words (a message, email, page copy, captions, a script to hand over)' },
    title: { type: 'string', description: 'Under 50 characters: what this draft is, e.g. "Instagram ad: office lunch orders"' },
    headline: { type: 'string', description: 'Required for image and video (set on the picture, and on the first 3 seconds of a clip): 3 to 7 words set on the picture in exact type, as a customer would say it: a review line or the card\'s number, else the pain in their words. Never a slogan or the brand name alone.' },
    copy: { type: 'string', description: 'The words of the asset, ready to use, in Markdown. For an ad: the headline, the primary text and the button. For a message or email: the message itself. For voice: the exact words spoken. No placeholders, no brackets to fill in' },
    visual: { type: 'string', description: 'image and video only: the first-second moment that stops a thumb, as things you can see. Pick ONE: a hand or person using the product mid-action; the problem moment just before the product fixes it; the product unboxed in hands; the product beside what it replaces; a first-person view of the routine. Shot close on a phone, slightly above, in a real home, office or outdoor setting, the product large in the lower two thirds, the top third a plain area for the headline. No mood words, no effects, no writing.' },
    motion: { type: 'string', description: 'video only: one sentence on what moves, in order, and the one camera move over 6 seconds (a slow push in, a pan, a static shot), with the pace' },
    ratio: { type: 'string', enum: RATIOS, description: 'image and video only: 4:5 for a feed ad, 9:16 for a reel or story, 1:1 for a square post' },
    script: { type: 'string', description: 'voice: the words spoken, under 60 words. video: an optional voiceover of at most 14 words, so it fits in 6 seconds; empty for a silent video' },
    voiceStyle: { type: 'string', description: 'voice only: how it is said, in a few words, e.g. "warm and unhurried"' },
    voice: { type: 'string', enum: VOICES, description: 'voice only: Kore, Aoede and Leda are female; Charon, Puck and Orus are male' },
    slides: { type: 'array', description: 'carousel only: 3 to 8 slides in swipe order. Slide 1 hooks, the middle slides deliver one point each, the last says what to do', items: { type: 'object', required: ['onSlide', 'visual'], properties: {
      onSlide: { type: 'string', description: 'The words set on the slide, under 12 words' },
      small: { type: 'string', description: 'Optional second line, under 14 words' },
      visual: { type: 'string', description: 'The photograph behind the words: the real product or the people who use it, setting and light. No writing anywhere in it' } } } },
    note: { type: 'string', description: 'Under 25 words: what this draft tries, for the person reviewing it' }
  }
};

// the planning prompt and the photo prompt, shared by the jam (one tap) and the background first drafts (drafts-bg.js)
const FORM = { voice: 'a voice recording', text: 'text', carousel: 'a carousel of 3 to 8 slides', image: 'an image', video: 'a video (a 6-second clip)' };
export const draftPrompt = ({ card, role = 'creative', brief = '', mem = '', as = 'auto', ask = '' }) => `${card}\n\nYou are the ${role} agent, and a team is planning this card in a jam.\n\nTHE JAM BRIEF (what the team agreed so far):\n----\n${String(brief || '').slice(0, 9000)}\n----\n${mem ? `\n${mem}\n` : ''}\nMake the first draft of the asset this brief asks for, ready for the team to react to.${as !== 'auto' ? ` Make it as ${FORM[as] || 'a video (a 6-second clip)'}, even if the brief had something else in mind.` : ' Pick the form the brief needs.'}${ask ? `\nThe person asked: ${ask}` : ''}\nRules: plain words, every number from the brief or the brand facts, no discounts or claims the brief does not make, no disclaimers. ${CLAIMS_RULE} ${COPY_RULE}\nOpen with the hook: the headline and the first line of the copy name the buyer's moment or a real customer's words from WHAT BUYERS SAY; borrow the structure (never the words) of the longest-running rival ads listed.`;
/* what real buyers say and the rival ads that keep running (brand-pack.js reviewQuotes, rivalHooks): the hook's raw material,
   added to the card context of every draft plan (here in the jam, and drafts-bg.js). '' when the read has neither */
export const hookBlock = ({ reviewQuotes = [], rivalHooks = [] } = {}) => [
  reviewQuotes?.length ? `WHAT BUYERS SAY (real reviews: echo their words, never invent one):\n${reviewQuotes.map((q) => `- "${String(q).replace(/"/g, '”')}"`).join('\n')}` : '',
  rivalHooks?.length ? `RIVAL ADS THAT KEEP RUNNING (the rival ads live longest: borrow how the hook is built, never their words, names, products or claims):\n${rivalHooks.map((h) => `- live ${h.days || '?'} days, ${h.format || 'image'} ad${h.hookPattern ? `; hook pattern: ${h.hookPattern}` : ''}${h.stopper ? `; what stops the scroll: ${h.stopper}` : ''}${h.hook ? `; their words, never to reuse: "${String(h.hook).replace(/"/g, '”')}"` : ''}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
/* the small line under a headline set on a picture: the ad's button, else its first short line that is not the headline */
export const smallOf = (copy = '', head = '') => { const n = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), h = n(head);
  const lines = String(copy || '').split('\n').map((x) => x.replace(/[#*_>`]/g, '').trim()).filter(Boolean);
  const btn = lines.map((l) => (/^(?:button|cta)[^:]{0,12}:\s*(.+)$/i.exec(l) || [])[1]).find(Boolean); if (btn) return btn.trim().slice(0, 40);
  const l = lines.map((x) => x.replace(/^(?:headline|primary text|text|body|subject|preview|caption)\s*:\s*/i, '')).find((x) => x.length <= 70 && n(x) && n(x) !== h && !(h && n(x).includes(h)));
  return l ? l.slice(0, 70) : ''; };
/* c: the card, whose asset line ("1 static image: an office worker at her desk wearing …") is the scene the picture must show.
   o.ratio: the ratio the picture is really made at; o.topSpace: a headline is set on it afterwards, so the top third stays calm */
export const imagePrompt = (j, hasSrc, c = null, brand = null, o = {}) => buildDraft({ kind: 'image', title: j.title, visual: j.visual, scene: sceneOf(c), hasSrc, ratio: o.ratio || j.ratio, topSpace: !!o.topSpace, brand: brand || {}, product: brand?.product ? { name: brand.product } : undefined }).prompt; /* one brief for drafts and finals (sloosh-prompt.js) */
export const DRAFT_SCHEMA = SCHEMA;
export const DRAFT_RATIOS = RATIOS;

export function createDrafts({ sourceOf = () => '', rivalAdOf = () => null, rivalStoreOf = () => null, hooksOf = () => null, claudeTool, geminiImage, treg, launchBrowser, zipBuffer, photoAsync, photoFile, photoOf, catalogOf = () => null, brandName = () => '', cardOf, briefOf, cardBrief, seatLine, isMock, spend, clean, now, uid, say, save, AGENT, onReady = null, log = console }) {
  const keyOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  /* a store photo by URL (the catalog's own image), fetched once into tmp */
  const fetchPhoto = async (u) => { const f = path.join(os.tmpdir(), 'brew-ph-' + keyOf(u) + '.jpg'); if (!fs.existsSync(f)) { const r = await safeFetch(u, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) return null; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; };
  const step = (t, w, d, text) => { d.step = text; save(t); };
  /* a rival ad card ("Make our version"): the ad and how it is made (rival-ad.js), read once per ad */
  const fileOfRel = async (rel) => { try { const f = /^https?:/.test(rel) ? await fetchPhoto(rel) : photoAsync ? await photoAsync(rel) : photoFile(rel); return f && fs.existsSync(f) ? f : null; } catch { return null; } };
  const rivalRead = async (t, c) => { const ad = isRivalCard(c) ? rivalAdOf(t, c) : null; if (!ad) return null; const style = isMock?.() ? null : await readRivalAd(ad, { call: claudeTool, fileOf: fileOfRel, store: rivalStoreOf(t), log }).catch(() => null); return { ad, style }; };

  // what to make, and the words: one forced tool call
  const plan = async (t, w, c, as, ask) => {
    const mem = await memoryBlockAsync(t, w.agent === 'brew' ? 'creative' : w.agent, `${w.title || ''} ${String(briefOf(t, w) || '').slice(0, 1500)}`); // brand memory: voice, creative style, rules, what works
    const rv = await rivalRead(t, c).catch(() => null);
    const hooks = hookBlock(hooksOf(t) || catalogOf(t)?.hooks || {}); /* real buyers' words and the rival ads that keep running (brand-pack.js hooksOf; feed-service passes them) */
    const prompt = draftPrompt({ card: c ? `${cardBrief(c, seatLine(t.viewer), t)}${rv ? `\n\n${rivalBlock(rv.ad, rv.style, brandName(t) || 'the brand')}` : ''}${hooks ? `\n\n${hooks}` : ''}` : `Jam: ${w.title}`, role: AGENT[w.agent] || 'creative', brief: briefOf(t, w), mem, as, ask });
    const j = await claudeTool(prompt, SCHEMA, 4500, 'draft'); /* 3000 was hit once: a plan cut off mid-JSON */
    try { cleanDraftClaims(j, sourceOf(t, c)); } catch {} /* QA-25: the store's own claims only (its facts, catalog, reviews, the card's evidence) */
    if (!DRAFT_AS.includes(j.as) || as !== 'auto') j.as = as === 'auto' ? 'text' : as;
    return j;
  };

  // the real product photo: a brand asset may live only in the bucket, so it is fetched when this instance lacks it
  /* after a jam photo, the product the plan's words name (a Hukum ad shows the Hukum shoe), then the card's own pictures */
  const namedItem = (t, j, c) => { const cat = catalogOf(t); if (!cat?.length || !j) return null; const words = [j.title, j.copy, j.headline, j.body, ...(j.slides || []).map((x) => x?.onSlide), c?.title, c?.sub].filter(Boolean).join('. ');
    return cardProduct(c, cat, { brand: brandName(t) }) || matchProduct(words, cat, { brand: brandName(t) }) || null; }; /* the card's asset line names the product first */
  const namedPhoto = (t, j, c) => namedItem(t, j, c)?.img || null;
  const cardNamed = (t, c) => { const cat = c && catalogOf(t); return cat?.length ? cardProduct(c, cat, { brand: brandName(t) }) : null; }; /* the product the card's asset line names, for the image guard */
  const productPhoto = async (c, j = null, t = null) => { for (const rel of [...(c?.refImages || []), namedPhoto(t, j, c), ...(c?.images || []).filter((u) => !isResearchImage(u)) /* a rival's ad is never our product */, photoOf(c), catalogOf(t)?.[0]?.img].filter(Boolean)) { /* a photo added in the jam comes first; the brand's lead product last */ try { const f = /^https?:/.test(rel) ? await fetchPhoto(rel) : photoAsync ? await photoAsync(rel) : photoFile(rel); if (f && fs.existsSync(f)) return f; } catch {} } return null; };
  /* never an invented product: with no real photo there is no picture, and the jam says how to add one */
  const needPhoto = (src) => { if (!src) throw Object.assign(new Error('There is no product photo for this yet. Add one with + (Product photo) and try again.'), { soft: true }); return src; };

  const makeImage = async (j, c, ratio, t = null) => {
    const src = needPhoto(await productPhoto(c, j, t));
    /* our version of a rival's ad: its composition and look in words (rival-ad.js), our product the only picture; our words sit where theirs do */
    const rv = await rivalRead(t, c).catch(() => null);
    const pic = rv?.style ? rivalPicture(rv.ad, rv.style, { headline: j.headline || String(j.copy || '').replace(/[#*_>`]/g, '').split('\n').map((x) => x.trim()).find(Boolean) || '', button: (String(j.copy || '').match(/button[^:]*:\s*([^\n]+)/i) || [])[1] || '' }) : null; /* the words on the picture, never the draft's internal title */
    const prompt = pic ? buildDraft({ kind: 'image', title: j.title, visual: `${j.visual || ''} ${pic.visual}`, refs: [{ ...pic.refs[0], label: `${brandName(t) || 'the brand'}'s product` }], text: pic.text, hasSrc: true, ratio, brand: { style: pic.look } }).prompt : imagePrompt(j, true, c, { name: brandName(t), product: c?.refImages?.length ? '' : namedItem(t, j, c)?.t || '' }, { ratio, topSpace: !!j.headline });
    /* the guard tries the model again and the other Gemini model; with no picture at all, the real product photo stands in (failed) */
    const buf = await geminiImage({ srcFile: src, prompt, ratio, named: cardNamed(t, c), text: [c?.make?.pieces, j.title, j.copy, j.headline, c?.title].filter(Boolean).join('. '), fallback: true });
    const failed = !!buf?.guard?.genFailed, name = keyOf(prompt + ratio + (failed ? '|photo' : '')) + (failed ? '.jpg' : '.png');
    saveGen(name, buf);
    return { name, buf, failed, rival: !!pic }; /* rival: the words sit in the picture already (our version of a rival's ad) */
  };

  /* the media makers live in createMakers (below), shared with the background first drafts (drafts-bg.js) */
  const M = createMakers({ geminiImage, treg, launchBrowser, zipBuffer, log });
  const makeCarousel = async (t, w, d, j, c) => {
    const slides = (j.slides || []).filter((x) => x?.onSlide).slice(0, 8); if (slides.length < 2) throw Object.assign(new Error('The plan came back without slides. Try again.'), { soft: true });
    const src = needPhoto(await productPhoto(c, j, t)), ratio = d.ratio === '9:16' ? '9:16' : d.ratio === '1:1' ? '1:1' : '4:5';
    const rv = await rivalRead(t, c).catch(() => null); /* our version of a rival's carousel: its composition and look, in words, on every slide */
    const named = cardNamed(t, c);
    const r = await M.carousel({ slides, src, ...(rv?.style ? { lookLine: ` ${rivalPicture(rv.ad, rv.style).visual}` } : {}), ratio, title: j.title, cardTitle: c?.title, scene: sceneOf(c), named, product: named?.t || '', brand: { name: brandName(t) }, id: d.id, clean, canSpend: (i) => i === 0 || spend('image'), onStep: (text) => step(t, w, d, text) });
    d.slides = r.slides; d.image = r.image; if (r.zip) d.zip = r.zip; if (r.err) d.err = r.err;
  };
  const makeVoice = (text, style, voice) => M.voice(text, style, voice);
  const makeVideo = (t, w, d, frameName, motion) => M.video(frameName, motion, { onStep: (text) => step(t, w, d, text) });
  const mux = (videoName, audioName) => M.mux(videoName, audioName);

  const make = async (t, w, d, as, ask) => {
    const c = cardOf(t, w.cardId);
    const j = await plan(t, w, c, as, ask);
    Object.assign(d, { as: j.as, title: clean(j.title || 'First draft').slice(0, 70), copy: clean(j.copy || ''), note: clean(j.note || ''), visual: clean(j.visual || '').slice(0, 600), motion: clean(j.motion || '').slice(0, 300), /* kept for the final: the same brief, rerun on the strong model */ ratio: RATIOS.includes(j.ratio) ? j.ratio : j.as === 'video' ? '9:16' : '4:5' });
    if (j.as === 'carousel') {
      if (!launchBrowser) throw Object.assign(new Error('Carousels can’t be made on this server. The words are here.'), { soft: true });
      if (!spend('image')) throw Object.assign(new Error((budgetWhy('image') || 'The image budget for today is used up.') + ' The words are here; try the slides tomorrow.'), { soft: true });
      d.ratio = RATIOS.includes(j.ratio) && j.ratio !== '16:9' ? j.ratio : '4:5'; d.copy = d.copy || (j.slides || []).map((x, i) => `${i + 1}. ${x.onSlide}`).join('\n');
      await makeCarousel(t, w, d, j, c);
    } else if (j.as === 'image' || j.as === 'video') {
      /* a video is 9:16 or 16:9 (Veo takes nothing else), and a video refused by today's limit says so before a picture is spent */
      if (j.as === 'video') { d.ratio = d.ratio === '16:9' ? '16:9' : '9:16'; const no = budgetWhy('video'); if (no) throw Object.assign(new Error(`${no} The words and motion are here.`), { soft: true }); }
      if (!spend('image')) throw Object.assign(new Error((budgetWhy('image') || 'The image budget for today is used up.') + ' The words are here; try the picture tomorrow.'), { soft: true });
      step(t, w, d, j.as === 'video' ? 'Making the first frame' : 'Making the image');
      const im = await makeImage(j, c, d.ratio, t); d.image = 'gen/' + im.name;
      /* the headline set on the picture in exact type (never drawn by the image model); a rival remake has its words in place already */
      if (j.headline) d.headline = clean(j.headline).slice(0, 80);
      if (j.as === 'image' && d.headline && !im.failed && !im.rival && launchBrowser && im.buf) d.render = await M.head(im.buf, { text: d.headline, small: smallOf(d.copy, d.headline) }, d.ratio, im.name).catch((e) => { log.warn('[draft headline]', e.message); return undefined; });
      /* a picture that didn't come through leaves the real product photo: an image says so; a video animates that real photo
         (still the right product) instead of stopping, and says so */
      if (im.failed && j.as !== 'video') throw Object.assign(new Error('The new picture didn’t come through, so this is the real product photo for now. Tap image again for a new one.'), { soft: true });
      if (im.failed) d.note = clean(`${d.note ? d.note + ' ' : ''}The first frame is the real product photo: the new scene didn't come through.`).slice(0, 240);
      if (j.as === 'video') {
        if (!spend('video')) throw Object.assign(new Error((budgetWhy('video') || 'The video budget for today is used up.') + ' Here is the first frame.'), { soft: true });
        step(t, w, d, 'Animating it, about two minutes');
        d.video = 'gen/' + (await makeVideo(t, w, d, d.image.slice(4), j.motion));
        if (j.script && spend('voice')) {
          step(t, w, d, 'Recording the voiceover'); const au = await makeVoice(j.script, j.voiceStyle, j.voice); d.script = clean(j.script);
          const both = await mux(d.video.slice(4), au).catch((e) => { log.warn('[draft mux]', e.message); return null; });
          if (both) d.video = 'gen/' + both; else d.audio = 'gen/' + au;
        }
      }
    } else if (j.as === 'voice') {
      if (!spend('voice')) throw Object.assign(new Error((budgetWhy('voice') || 'The voice budget for today is used up.') + ' The script is here.'), { soft: true });
      step(t, w, d, 'Recording it');
      d.script = clean(j.script || j.copy); d.audio = 'gen/' + (await makeVoice(d.script, j.voiceStyle, j.voice));
    }
  };

  // offline: the words only, from the brief itself, and it says so
  const mockDraft = (t, w, d, as) => { const md = String(briefOf(t, w) || ''); const first = md.split('\n').find((l) => l.trim() && !l.startsWith('#')) || w.title;
    Object.assign(d, { as: as === 'auto' ? 'text' : as, title: `First draft: ${w.title}`.slice(0, 70), copy: first, note: 'AI is offline, so this is the brief’s own words. Try again shortly for a real draft.' }); };

  /* drafts being made on this instance. A draft left 'making' that isn't here was cut off by a restart: it is marked failed so the jam can make another */
  const inflight = new Set();
  const heal = (w) => { (w?.drafts || []).forEach((d) => { if (d.state === 'making' && !inflight.has(d.id) && Date.now() - (d.startedReal || 0) > 5000) Object.assign(d, { state: 'failed', step: null, err: 'This draft was interrupted. Try again.' }); }); return w; };
  const start = (t, w, as, ask) => {
    w.drafts ||= [];
    /* the plan's own button says the form: "Make the video" makes a video, never a still the AI picked instead */
    if (as === 'auto') { const pl = w.cardPlan || cardOf(t, w.cardId)?.plan, cta = `${pl?.cta || ''} ${pl?.make?.what || ''}`;
      as = /\b(videos?|reels?|clips?|shorts)\b/i.test(cta) ? 'video' : /\bcarousels?\b/i.test(cta) ? 'carousel' : 'auto'; }
    const d = { id: uid('dr'), as, asked: as, state: 'making', step: 'Reading the brief', at: now(t), startedReal: Date.now(), by: t.viewer?.name || null };
    w.drafts.unshift(d); w.drafts.splice(MAX_KEEP); inflight.add(d.id);
    (async () => {
      try {
        if (isMock() || !spend('text')) mockDraft(t, w, d, as); else await make(t, w, d, as, ask);
        d.state = 'ready';
      } catch (e) {
        log.warn('[draft]', e.message);
        d.state = d.copy ? 'ready' : 'failed'; d.err = e.soft ? e.message : /filtered/i.test(e.message) && d.image ? 'The video model turned this frame down, so here is the picture. Ask for the video again and Brew tries another scene.' : d.copy ? 'The words are here, but the media didn’t come through. Try again.' : 'That didn’t work. Try again.';
      }
      inflight.delete(d.id); d.step = null; d.doneAt = now(t);
      if (d.state === 'ready') say(t, w, { from: 'ai', who: AGENT[w.agent] || 'AI', body: `First draft ready: ${d.title}. It’s at the top of the brief.` });
      if (d.state === 'ready') try { onReady?.(t, w, d); } catch (e) { log.warn('[draft ready]', e.message); } /* e.g. posted to the jam's Slack thread for review */
      save(t);
    })();
    return d;
  };

  const routes = ({ on, W }) => {
    // one tap: make the asset this brief asks for (as: auto) or in a form you pick
    on('POST', '/api/work/:wid/draft', async (b, t, p) => {
      const w = W(t, p.wid); if (!w) return { error: 'not found' };
      if ((w.drafts || []).some((x) => x.state === 'making' && now(t) - x.at < 12 * 60e3)) return { error: 'A draft is still being made. It’ll be here in a moment.', work: w };
      const as = DRAFT_AS.includes(b.as) ? b.as : 'auto';
      start(t, w, as, String(b.ask || '').slice(0, 300));
      return { work: w };
    });
    on('POST', '/api/work/:wid/draft/:did/drop', async (b, t, p) => {
      const w = W(t, p.wid); if (!w) return { error: 'not found' };
      w.drafts = (w.drafts || []).filter((x) => x.id !== p.did); return { work: w };
    });
  };

  return { routes, start, heal };
}

// The media makers, shared by the jam (one tap) and the background first drafts (drafts-bg.js): a carousel (a photo per
// slide, the words set in exact type by Chromium), a 6-second video from a still (Veo 3.1 Fast on our Vertex account), a voice line,
// the voiceover muxed in with ffmpeg, and any HTML page shot to an image with Chromium (mock emails, chats, pages, grids).
export const HEAD_V = 2; /* 2 (25 Oct): a still's words in their own panel above the whole picture (drafts-bg healHeads sets saved ones again) */
export function createMakers({ geminiImage, treg, launchBrowser, zipBuffer, save = saveGen, file = genFile, log = console }) {
  const keyOf = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const W = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
  // any HTML at an exact size, as a JPEG
  const shoot = async (browser, html, [w, h]) => { const page = await browser.newPage();
    try { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await page.setContent(html, { waitUntil: 'load' }); return await page.screenshot({ type: 'jpeg', quality: 88 }); }
    finally { await page.close().catch(() => {}); } };
  /* the words in exact type at the top of a picture (buf) or of a clear sheet (no buf: laid over a clip). A tall frame (9:16)
     keeps its words below the top sixth, where Stories and Reels draw their own bars */
  const mimeOf = (b) => (b[0] === 0xff ? 'image/jpeg' : b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png');
  /* a still picture (layout 2, 25 Oct): the words get their own white panel at the top and the picture sits whole under them,
     fitted on a soft blurred copy of itself, so the words never cover the product (a dark band over a bottle's cap read as a
     broken ad). A clip keeps its words over the frame (the sheet below), it can't be re-laid out */
  const panelHtml = ({ w, h, buf, text, small = '', n, of }) => { const k = w / 1080, px = (x) => `${Math.round(x * k)}px`, src = `data:${mimeOf(buf)};base64,${buf.toString('base64')}`, tall = h / w > 1.6;
    const size = text.length < 28 ? 80 : text.length < 56 ? 64 : 54;
    return `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#fff;font-family:"Helvetica Neue",Helvetica,Inter,Arial,sans-serif}
        body{display:flex;flex-direction:column}.t{flex:none;padding:${tall ? Math.round(h * 0.15) : Math.round(66 * k)}px ${px(76)} ${px(40)}}
        h1{margin:0;color:#14161a;font-weight:700;font-size:${px(size)};line-height:1.1;letter-spacing:-.015em}p{margin:${px(14)} 0 0;color:#5b6070;font-size:${px(32)};line-height:1.3}
        .pic{position:relative;flex:1;min-height:0;overflow:hidden}.pic .b{position:absolute;inset:-40px;background:url(${src}) center/cover;filter:blur(36px) brightness(1.04);opacity:.9}.pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
        .n{position:absolute;right:${px(40)};top:${px(40)};padding:${px(6)} ${px(16)};border-radius:999px;background:rgba(0,0,0,.45);color:#fff;font-size:${px(26)}}</style></head>
        <body><div class="t"><h1>${esc(text)}</h1>${small ? `<p>${esc(small)}</p>` : ''}</div><div class="pic"><div class="b"></div><img src="${src}"></div>${of > 1 ? `<span class="n">${n}/${of}</span>` : ''}</body></html>`; };
  const typeHtml = ({ w, h, buf = null, text, small = '', n, of }) => { if (buf) return panelHtml({ w, h, buf, text, small, n, of }); const k = w / 1080, top = h / w > 1.6 ? Math.round(h * 0.17) : Math.round(76 * k), px = (x) => `${Math.round(x * k)}px`;
    const size = text.length < 28 ? 84 : text.length < 56 ? 68 : 56;
    return `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent;font-family:"Helvetica Neue",Helvetica,Inter,Arial,sans-serif}
        .bg{position:absolute;inset:0;${buf ? `background:url(data:${mimeOf(buf)};base64,${buf.toString('base64')}) center/cover no-repeat` : ''}}
        .s{position:absolute;left:0;right:0;top:0;height:${Math.round(top + h * 0.42)}px;background:linear-gradient(180deg,rgba(10,12,20,.82),rgba(10,12,20,.5) 50%,rgba(10,12,20,0))}
        .t{position:absolute;left:${px(72)};right:${px(84)};top:${top}px}h1{margin:0;color:#fff;font-weight:700;font-size:${px(size)};line-height:1.1;letter-spacing:-.01em}
        p{margin:${px(18)} 0 0;color:rgba(255,255,255,.88);font-size:${px(36)};line-height:1.3}.n{position:absolute;right:${px(40)};top:${px(40)};padding:${px(6)} ${px(16)};border-radius:999px;background:rgba(0,0,0,.45);color:#fff;font-size:${px(26)}}</style></head>
        <body><div class="bg"></div><div class="s"></div><div class="t"><h1>${esc(text)}</h1>${small ? `<p>${esc(small)}</p>` : ''}</div>${of > 1 ? `<span class="n">${n}/${of}</span>` : ''}</body></html>`; };
  const setType = async (browser, buf, { text, small, n, of }, ratio) => { const [w, h] = W[ratio] || W['4:5']; return shoot(browser, typeHtml({ w, h, buf, text, small, n, of }), [w, h]); };
  /* one picture with its headline set (a single image ad, the first frame of a clip, a real-photo stand-in): → 'gen/<name>.jpg' */
  const head = async (buf, { text, small = '' }, ratio = '4:5', key = '') => { if (!buf || !text) return null; const browser = await launchBrowser();
    try { const out = await setType(browser, buf, { text, small }, ratio); const name = keyOf(`head${HEAD_V}|${key}|${text}|${small}|${ratio}`) + '.jpg'; /* a new layout is a new file, never a cached old one */ save(name, out); return 'gen/' + name; }
    finally { await browser.close?.().catch?.(() => {}); } };
  /* the headline on a clip's first seconds: Chromium sets it on a clear sheet at the clip's own size, ffmpeg lays it over
     (scaled to the clip whatever its size) and keeps the sound → '<name>.mp4', or null without a clip */
  const probe = (f) => new Promise((res) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', f], { timeout: 20e3 }, (e, out) => { const m = /(\d+)x(\d+)/.exec(String(out || '')); res(e || !m ? null : [+m[1], +m[2]]); }));
  const headClip = async (videoName, { text, small = '' }, { seconds = 3 } = {}) => {
    const v = await file(videoName); if (!v || !text) return null;
    const [w, h] = (await probe(v)) || W['9:16'];
    const browser = await launchBrowser(); let png;
    try { const page = await browser.newPage();
      try { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await page.setContent(typeHtml({ w, h, text, small }), { waitUntil: 'load' }); png = await page.screenshot({ type: 'png', omitBackground: true }); }
      finally { await page.close().catch(() => {}); } }
    finally { await browser.close?.().catch?.(() => {}); }
    const pf = path.join(os.tmpdir(), keyOf(`head|${videoName}|${text}|${small}`) + '.png'), out = path.join(os.tmpdir(), keyOf(`headclip|${videoName}|${text}|${small}`) + '.mp4');
    fs.writeFileSync(pf, png);
    try { await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', '-i', v, '-loop', '1', '-i', pf, '-filter_complex', `[1:v][0:v]scale2ref[ov][base];[base][ov]overlay=0:0:enable='lt(t,${seconds})':shortest=1,format=yuv420p[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', out], { timeout: 120e3 }, (e) => (e ? rej(e) : res())));
      const name = path.basename(out); save(name, fs.readFileSync(out)); return name; }
    finally { fs.rmSync(pf, { force: true }); fs.rmSync(out, { force: true }); } };
  // a carousel: one photo per slide (3 at a time), then the words set in exact type by Chromium, never drawn by the model.
  // canSpend(i) says whether slide i may be made; bufs carry the image guard's note (guard.retried) so callers can book real cost
  /* product and brand name the subject ("The subject is the Paw Warmer"), never "The subject is The product." */
  const carousel = async ({ slides, src, lookLine = '', ratio, title, cardTitle, scene = '', named = null, product = '', brand = {}, id, slug = undefined, clean = (x) => String(x || ''), canSpend = () => true, onStep = () => {} }) => {
    const raws = []; let budgetHit = false; /* a slide refused by the day's picture budget: the caller makes the set again tomorrow */
    for (let k = 0; k < slides.length; k += 3) {
      onStep(`Making the photos (${Math.min(k + 3, slides.length)} of ${slides.length})`);
      raws.push(...(await Promise.all(slides.slice(k, k + 3).map(async (x, m) => {
        if (!canSpend(k + m)) { budgetHit = true; return null; }
        const prompt = buildDraft({ kind: 'image', title: `${title} carousel`, visual: `${x.visual || ''}${lookLine}`, scene: scene ? `The set as a whole shows what the card promises: ${scene}.` : '', index: k + m + 1, count: slides.length, topSpace: true, hasSrc: !!src, ratio, product: (product || named?.t) ? { name: product || named.t } : undefined, brand: brand?.name ? { name: brand.name } : {} }).prompt;
        try { return await geminiImage({ srcFile: src, prompt, ratio, named, slug, text: [x?.onSlide, title, cardTitle].filter(Boolean).join('. '), fallback: true }); } catch (e) { if (e.budget) budgetHit = true; log.warn('[draft slide]', e.message); return null; } /* fallback: a slide with no new photo carries the real product photo under its words */
      }))));
    }
    if (!raws.some(Boolean)) throw Object.assign(new Error(budgetHit ? 'The slides wait for the picture budget.' : 'no slide photo came back'), { budget: budgetHit, noSlides: true });
    onStep('Setting the words on each slide');
    const browser = await launchBrowser(), out = [];
    try { for (let i = 0; i < slides.length; i++) { if (!raws[i]) continue; const buf = await setType(browser, raws[i], { text: clean(slides[i].onSlide), small: clean(slides[i].small || ''), n: i + 1, of: slides.length }, ratio);
      const name = keyOf(id + i + slides[i].onSlide) + '.jpg'; save(name, buf); out.push({ text: clean(slides[i].onSlide), image: 'gen/' + name, buf, n: i + 1 }); } }
    finally { await browser.close().catch(() => {}); }
    const r = { slides: out.map(({ text, image }) => ({ text, image })), image: out[0]?.image || null, made: raws.filter(Boolean).length, retried: raws.filter((b) => b?.guard?.retried).length };
    if (zipBuffer && out.length > 1) { const z = keyOf(id + 'zip') + '.zip'; save(z, zipBuffer(out.map((x) => ({ name: `slide-${String(x.n).padStart(2, '0')}.jpg`, data: x.buf })))); r.zip = 'gen/' + z; }
    if (out.length < slides.length) r.err = `${slides.length - out.length} of ${slides.length} slides didn’t come through. The rest are here.`;
    const stand = raws.filter((b) => b?.guard?.genFailed).length; if (stand) { r.made -= stand; r.err = [r.err, `${stand} slide${stand > 1 ? 's use' : ' uses'} the real product photo for now.`].filter(Boolean).join(' '); }
    return r;
  };

  // voice and video are made on our own Google Cloud account (vertex-media.js), never through treg
  const voice = async (text, style, v) => {
    const wav = await vertexVoice(`${style ? `Say it ${style}: ` : ''}${text}`, VOICES.includes(v) ? v : 'Kore');
    const name = keyOf(text + v + style) + '.wav'; save(name, wav); return name;
  };

  // Veo 3.1 Fast, 6 s at 1080p from the first frame: one handheld shot, hands may use the product, which keeps its shape and mark
  const video = async (frameName, motion, { onStep = () => {}, ratio = '9:16' } = {}) => {
    const ff = await file(frameName); if (!ff) throw new Error('the first frame is missing'); const frame = fs.readFileSync(ff);
    const buf = await vertexVideo(frame, buildDraft({ kind: 'video', motion, ratio }).prompt,
      { ratio, onWait: () => onStep('Animating it, about a minute more') });
    const name = keyOf(frameName + (motion || '')) + '.mp4'; save(name, buf); return name;
  };

  // the voiceover goes into the clip itself (ffmpeg in the image); without ffmpeg it stays a separate track
  const mux = async (videoName, audioName) => {
    const [v, a] = await Promise.all([file(videoName), file(audioName)]); if (!v || !a) return null;
    const out = path.join(os.tmpdir(), keyOf(videoName + audioName) + '.mp4');
    await new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', '-i', v, '-i', a, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-af', 'apad', '-shortest', out], { timeout: 60e3 }, (e) => (e ? rej(e) : res())));
    const name = path.basename(out); save(name, fs.readFileSync(out)); fs.rmSync(out, { force: true }); return name;
  };

  // an HTML mock (email, chat, page, product grid) shot once and saved: → 'gen/<name>.jpg'
  const render = async (html, ratio = '4:5', key = html) => { const browser = await launchBrowser();
    try { const buf = await shoot(browser, html, W[ratio] || W['4:5']); const name = keyOf('mock' + key) + '.jpg'; save(name, buf); return 'gen/' + name; } finally { await browser.close().catch(() => {}); } };
  return { carousel, voice, video, mux, render, setType, head, headClip, shoot, SIZES: W };
}

/* local tests only (MEDIA_FAKE=1, never on Cloud Run): the same video path at no cost. The "frame" is the reference photo
   itself, the "clip" is that frame held for 6 seconds and the "voice" a tone, all made by ffmpeg, then muxed for real */
export function fakeMakers({ save = saveGen, file = genFile } = {}) {
  const keyOf = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
  const ff = (args) => new Promise((res, rej) => execFile('ffmpeg', ['-y', '-v', 'error', ...args], { timeout: 60e3 }, (e) => (e ? rej(e) : res())));
  const real = createMakers({ geminiImage: null, save, file });
  const image = async ({ srcFile }) => fs.readFileSync(srcFile);
  const video = async (frameName, motion, { onStep = () => {} } = {}) => { const f = await file(frameName); if (!f) throw new Error('the first frame is missing'); onStep('Animating it (fake)');
    const out = path.join(os.tmpdir(), keyOf('fake' + frameName + motion) + '.mp4');
    await ff(['-loop', '1', '-i', f, '-t', '6', '-vf', 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,format=yuv420p', '-c:v', 'libx264', '-r', '24', out]);
    const name = path.basename(out); save(name, fs.readFileSync(out)); fs.rmSync(out, { force: true }); return name; };
  const voice = async (text) => { const out = path.join(os.tmpdir(), keyOf('fakev' + text) + '.wav'); await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', out]);
    const name = path.basename(out); save(name, fs.readFileSync(out)); fs.rmSync(out, { force: true }); return name; };
  return { image, makers: { ...real, video, voice } };
}
