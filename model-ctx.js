// What the person picked in the jam's composer, for the length of one request: which model thinks (Auto, Deep, Fast),
// which one makes images, and whether Brew's memory is used. The client sends it as headers (x-model, x-image-model,
// x-memory); every AI call inside that request reads it here, so no route has to pass it along.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
export const THINK = { deep: 'claude-opus-5-5', fast: 'claude-sonnet-5-5' }; // auto keeps the server's default
export const IMAGE = ['gemini', 'gpt-image'];
export const prefsOf = (req) => ({
  think: THINK[String(req.headers['x-model'] || '').toLowerCase()] ? String(req.headers['x-model']).toLowerCase() : 'auto',
  image: IMAGE.includes(String(req.headers['x-image-model'] || '')) ? String(req.headers['x-image-model']) : 'auto',
  memory: String(req.headers['x-memory'] || '') !== 'off'
});
export const withPrefs = (prefs, fn) => als.run(prefs, fn);
export const prefs = () => als.getStore() || { think: 'auto', image: 'auto', memory: true };
export const thinkModel = (fallback) => THINK[prefs().think] || fallback;
