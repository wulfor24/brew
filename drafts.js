// First drafts in a jam, one tap away. AI reads the jam's brief and makes the asset it asks for, in the form it
// needs: an image (the brand's real product photo in a new scene), a short video (that image animated), a voice
// line, or plain text (ad copy, a WhatsApp message, an email, page copy). Nothing is made until someone taps:
// a draft costs money, so it is never made for a card nobody opened.
// Each draft lives on the jam (w.drafts), newest first; the client polls the jam while one is being made.
import { makeVoice as vertexVoice, makeVideo as vertexVideo } from './media.js'; // Sloosh first once connected, then Vertex, then OpenAI (media.js)
import { matchProduct } from './product-match.js';
import crypto from 'node:crypto';
import { safeFetch } from './reader/util.js'; // photo links reach only the public internet
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { saveGen, genFile } from './gen-store.js';
import { memoryBlockAsync } from './learn.js'; // brand memory (brand-memory.js), '' when off

export const DRAFT_AS = ['image', 'carousel', 'video', 'voice', 'text'];
const VOICES = ['Kore', 'Aoede', 'Leda', 'Charon', 'Puck', 'Orus'];
const RATIOS = ['1:1', '4:5', '9:16', '16:9'];
const MAX_KEEP = 12;

const SCHEMA = {
  type: 'object', required: ['as', 'title', 'copy'], properties: {
    as: { type: 'string', enum: DRAFT_AS, description: 'The form the brief needs: image for a single static ad or post, carousel for a swipeable carousel (ad or post) or a set of Stories, video for a reel or video ad, voice for a voice note, voiceover or radio-style spot, text for copy that ships as words (a message, email, page copy, captions, a script to hand over)' },
    title: { type: 'string', description: 'Under 50 characters: what this draft is, e.g. "Instagram ad: office lunch orders"' },
    copy: { type: 'string', description: 'The words of the asset, ready to use, in Markdown. For an ad: the headline, the primary text and the button. For a message or email: the message itself. For voice: the exact words spoken. No placeholders, no brackets to fill in' },
    visual: { type: 'string', description: 'image and video only: one or two sentences describing the photograph around the real product (setting, light, props, who is there). No writing anywhere except the product\'s own label: no calendars, notes, signs, screens or other packaging' },
    motion: { type: 'string', description: 'video only: one sentence on what moves and how the camera moves over 6 seconds' },
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
export const draftPrompt = ({ card, role = 'creative', brief = '', mem = '', as = 'auto', ask = '' }) => `${card}\n\nYou are the ${role} agent, and a team is planning this card in a jam.\n\nTHE JAM BRIEF (what the team agreed so far):\n----\n${String(brief || '').slice(0, 9000)}\n----\n${mem ? `\n${mem}\n` : ''}\nMake the first draft of the asset this brief asks for, ready for the team to react to.${as !== 'auto' ? ` Make it as ${as === 'voice' ? 'a voice recording' : as === 'text' ? 'text' : as === 'carousel' ? 'a carousel of 3 to 8 slides' : 'an ' + (as === 'image' ? 'image' : 'video')}${as === 'video' ? ' (a 6-second clip)' : ''}, even if the brief had something else in mind.` : ' Pick the form the brief needs.'}${ask ? `\nThe person asked: ${ask}` : ''}\nRules: plain words, every number from the brief or the brand facts, no discounts or claims the brief does not make, no disclaimers.`;
export const imagePrompt = (j, hasSrc) => `Create a new photograph for ${j.title}. ${j.visual || 'The product on a clean surface in soft daylight.'} ${hasSrc ? 'Keep the product and its label exactly as in the reference photo; do not invent new text on it.' : ''} Nothing else in the picture carries writing: no calendars, notes, signs, screens, books or other packaging. No logos, no watermarks. Photographic, natural light, made for a phone screen.`;
export const DRAFT_SCHEMA = SCHEMA;
export const DRAFT_RATIOS = RATIOS;

export function createDrafts({ claudeTool, geminiImage, treg, launchBrowser, zipBuffer, photoAsync, photoFile, photoOf, catalogOf = () => null, brandName = () => '', cardOf, briefOf, cardBrief, seatLine, isMock, spend, clean, now, uid, say, save, AGENT, onReady = null, log = console }) {
  const keyOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  /* a store photo by URL (the catalog's own image), fetched once into tmp */
  const fetchPhoto = async (u) => { const f = path.join(os.tmpdir(), 'brew-ph-' + keyOf(u) + '.jpg'); if (!fs.existsSync(f)) { const r = await safeFetch(u, { signal: AbortSignal.timeout(20e3) }); if (!r.ok) return null; fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return f; };
  const step = (t, w, d, text) => { d.step = text; save(t); };

  // what to make, and the words: one forced tool call
  const plan = async (t, w, c, as, ask) => {
    const mem = await memoryBlockAsync(t, w.agent === 'brew' ? 'creative' : w.agent, `${w.title || ''} ${String(briefOf(t, w) || '').slice(0, 1500)}`); // brand memory: voice, creative style, rules, what works
    const prompt = draftPrompt({ card: c ? cardBrief(c, seatLine(t.viewer)) : `Jam: ${w.title}`, role: AGENT[w.agent] || 'creative', brief: briefOf(t, w), mem, as, ask });
    const j = await claudeTool(prompt, SCHEMA, 2500, 'draft');
    if (!DRAFT_AS.includes(j.as) || as !== 'auto') j.as = as === 'auto' ? 'text' : as;
    return j;
  };

  // the real product photo: a brand asset may live only in the bucket, so it is fetched when this instance lacks it
  /* after a jam photo, the product the plan's words name (a Hukum ad shows the Hukum shoe), then the card's own pictures */
  const namedPhoto = (t, j, c) => { const cat = catalogOf(t); if (!cat?.length || !j) return null; const words = [j.title, j.copy, j.headline, j.body, ...(j.slides || []).map((x) => x?.onSlide), c?.title, c?.sub].filter(Boolean).join('. ');
    return matchProduct(words, cat, { brand: brandName(t) })?.img || null; };
  const productPhoto = async (c, j = null, t = null) => { for (const rel of [...(c?.refImages || []), namedPhoto(t, j, c), ...(c?.images || []), photoOf(c), catalogOf(t)?.[0]?.img].filter(Boolean)) { /* a photo added in the jam comes first; the brand's lead product last */ try { const f = /^https?:/.test(rel) ? await fetchPhoto(rel) : photoAsync ? await photoAsync(rel) : photoFile(rel); if (f && fs.existsSync(f)) return f; } catch {} } return null; };
  /* never an invented product: with no real photo there is no picture, and the jam says how to add one */
  const needPhoto = (src) => { if (!src) throw Object.assign(new Error('There is no product photo for this yet. Add one with + (Product photo) and try again.'), { soft: true }); return src; };

  const makeImage = async (j, c, ratio, t = null) => {
    const src = needPhoto(await productPhoto(c, j, t));
    const prompt = imagePrompt(j, true);
    /* the guard tries the model again and the other Gemini model; with no picture at all, the real product photo stands in (failed) */
    const buf = await geminiImage({ srcFile: src, prompt, ratio, text: [j.title, j.copy, j.headline, c?.title].filter(Boolean).join('. '), fallback: true });
    const failed = !!buf?.guard?.genFailed, name = keyOf(prompt + ratio + (failed ? '|photo' : '')) + (failed ? '.jpg' : '.png');
    saveGen(name, buf);
    return { name, buf: null, failed };
  };

  /* the media makers live in createMakers (below), shared with the background first drafts (drafts-bg.js) */
  const M = createMakers({ geminiImage, treg, launchBrowser, zipBuffer, log });
  const makeCarousel = async (t, w, d, j, c) => {
    const slides = (j.slides || []).filter((x) => x?.onSlide).slice(0, 8); if (slides.length < 2) throw Object.assign(new Error('The plan came back without slides. Try again.'), { soft: true });
    const src = needPhoto(await productPhoto(c, j, t)), ratio = d.ratio === '9:16' ? '9:16' : d.ratio === '1:1' ? '1:1' : '4:5';
    const r = await M.carousel({ slides, src, ratio, title: j.title, cardTitle: c?.title, id: d.id, clean, canSpend: (i) => i === 0 || spend('image'), onStep: (text) => step(t, w, d, text) });
    d.slides = r.slides; d.image = r.image; if (r.zip) d.zip = r.zip; if (r.err) d.err = r.err;
  };
  const makeVoice = (text, style, voice) => M.voice(text, style, voice);
  const makeVideo = (t, w, d, frameName, motion) => M.video(frameName, motion, { onStep: (text) => step(t, w, d, text) });
  const mux = (videoName, audioName) => M.mux(videoName, audioName);

  const make = async (t, w, d, as, ask) => {
    const c = cardOf(t, w.cardId);
    const j = await plan(t, w, c, as, ask);
    Object.assign(d, { as: j.as, title: clean(j.title || 'First draft').slice(0, 70), copy: clean(j.copy || ''), note: clean(j.note || ''), ratio: RATIOS.includes(j.ratio) ? j.ratio : j.as === 'video' ? '9:16' : '4:5' });
    if (j.as === 'carousel') {
      if (!launchBrowser) throw Object.assign(new Error('Carousels can’t be made on this server. The words are here.'), { soft: true });
      if (!spend('image')) throw Object.assign(new Error('The image budget for today is used up. The words are here; try the slides tomorrow.'), { soft: true });
      d.ratio = RATIOS.includes(j.ratio) && j.ratio !== '16:9' ? j.ratio : '4:5'; d.copy = d.copy || (j.slides || []).map((x, i) => `${i + 1}. ${x.onSlide}`).join('\n');
      await makeCarousel(t, w, d, j, c);
    } else if (j.as === 'image' || j.as === 'video') {
      if (!spend('image')) throw Object.assign(new Error('The image budget for today is used up. The words are here; try the picture tomorrow.'), { soft: true });
      step(t, w, d, j.as === 'video' ? 'Making the first frame' : 'Making the image');
      const im = await makeImage(j, c, d.ratio, t); d.image = 'gen/' + im.name;
      if (im.failed) throw Object.assign(new Error(`The new picture didn’t come through, so this is the real product photo for now. Tap ${j.as === 'video' ? 'video' : 'image'} again for a new one.`), { soft: true });
      if (j.as === 'video') {
        if (!spend('video')) throw Object.assign(new Error('The video budget for today is used up. Here is the first frame.'), { soft: true });
        step(t, w, d, 'Animating it, about two minutes');
        d.video = 'gen/' + (await makeVideo(t, w, d, d.image.slice(4), j.motion));
        if (j.script && spend('voice')) {
          step(t, w, d, 'Recording the voiceover'); const au = await makeVoice(j.script, j.voiceStyle, j.voice); d.script = clean(j.script);
          const both = await mux(d.video.slice(4), au).catch((e) => { log.warn('[draft mux]', e.message); return null; });
          if (both) d.video = 'gen/' + both; else d.audio = 'gen/' + au;
        }
      }
    } else if (j.as === 'voice') {
      if (!spend('voice')) throw Object.assign(new Error('The voice budget for today is used up. The script is here.'), { soft: true });
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
        d.state = d.copy ? 'ready' : 'failed'; d.err = e.soft ? e.message : d.copy ? 'The words are here, but the media didn’t come through. Try again.' : 'That didn’t work. Try again.';
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
export function createMakers({ geminiImage, treg, launchBrowser, zipBuffer, save = saveGen, file = genFile, log = console }) {
  const keyOf = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const W = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
  // any HTML at an exact size, as a JPEG
  const shoot = async (browser, html, [w, h]) => { const page = await browser.newPage();
    try { await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await page.setContent(html, { waitUntil: 'load' }); return await page.screenshot({ type: 'jpeg', quality: 88 }); }
    finally { await page.close().catch(() => {}); } };
  const setType = async (browser, buf, { text, small, n, of }, ratio) => {
    const [w, h] = W[ratio] || W['4:5'];
    const size = text.length < 28 ? 84 : text.length < 56 ? 68 : 56;
    return shoot(browser, `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:"Helvetica Neue",Helvetica,Inter,Arial,sans-serif}
        .bg{position:absolute;inset:0;background:url(data:image/png;base64,${buf.toString('base64')}) center/cover no-repeat}
        .s{position:absolute;left:0;right:0;top:0;height:58%;background:linear-gradient(180deg,rgba(10,12,20,.82),rgba(10,12,20,.5) 50%,rgba(10,12,20,0))}
        .t{position:absolute;left:72px;right:84px;top:76px}h1{margin:0;color:#fff;font-weight:700;font-size:${size}px;line-height:1.1;letter-spacing:-.01em}
        p{margin:18px 0 0;color:rgba(255,255,255,.88);font-size:36px;line-height:1.3}.n{position:absolute;right:40px;top:40px;padding:6px 16px;border-radius:999px;background:rgba(0,0,0,.45);color:#fff;font-size:26px}</style></head>
        <body><div class="bg"></div><div class="s"></div><div class="t"><h1>${esc(text)}</h1>${small ? `<p>${esc(small)}</p>` : ''}</div>${of > 1 ? `<span class="n">${n}/${of}</span>` : ''}</body></html>`, [w, h]);
  };
  // a carousel: one photo per slide (3 at a time), then the words set in exact type by Chromium, never drawn by the model.
  // canSpend(i) says whether slide i may be made; bufs carry the image guard's note (guard.retried) so callers can book real cost
  const carousel = async ({ slides, src, ratio, title, cardTitle, id, clean = (x) => String(x || ''), canSpend = () => true, onStep = () => {} }) => {
    const raws = [];
    for (let k = 0; k < slides.length; k += 3) {
      onStep(`Making the photos (${Math.min(k + 3, slides.length)} of ${slides.length})`);
      raws.push(...(await Promise.all(slides.slice(k, k + 3).map(async (x, m) => {
        if (!canSpend(k + m)) return null;
        const prompt = `Create photograph ${k + m + 1} of ${slides.length} for one ${title} carousel; every photo shares the same look, light and colour. ${x.visual} ${src ? 'Keep the product and its label exactly as in the reference photo.' : ''} No writing anywhere except the product's own label: no signs, notes, calendars, screens or other packaging. Keep the top third calm and simple, words will sit there. Photographic, natural light.`;
        try { return await geminiImage({ srcFile: src, prompt, ratio, text: [x?.onSlide, title, cardTitle].filter(Boolean).join('. '), fallback: true }); } catch (e) { log.warn('[draft slide]', e.message); return null; } /* fallback: a slide with no new photo carries the real product photo under its words */
      }))));
    }
    if (!raws.some(Boolean)) throw new Error('no slide photo came back');
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

  // Veo 3.1 Fast, 6 s at 1080p from the first frame: the product stays put, only light and camera move
  const video = async (frameName, motion, { onStep = () => {}, ratio = '9:16' } = {}) => {
    const ff = await file(frameName); if (!ff) throw new Error('the first frame is missing'); const frame = fs.readFileSync(ff);
    const buf = await vertexVideo(frame, `${motion || 'The camera slowly pushes in.'} The product stays still, upright and in sharp focus, its label unchanged and readable; only the light and the camera move, slowly. No new text appears.`,
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
  return { carousel, voice, video, mux, render, setType, shoot, SIZES: W };
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
