import test from 'node:test';
import assert from 'node:assert';
import { toGemini, fromGemini, geminiModel, GEMINI } from '../gemini-client.js';

test('Claude params become a Vertex body: system, images, search, schema, thinking', () => {
  const b = toGemini({ model: 'claude-opus-5-5', max_tokens: 32000, system: [{ type: 'text', text: 'Be brief.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] },
      { role: 'assistant', content: 'ok' }, { role: 'user', content: 'again' }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'IN' } }],
    thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object', properties: {} } } } });
  assert.deepEqual(b.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(b.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'AAA' } });
  assert.deepEqual(b.tools, [{ googleSearch: {} }]);
  assert.match(b.systemInstruction.parts[0].text, /Be brief\.[\s\S]*as someone in IN/);
  assert.equal(b.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
  assert.equal(b.generationConfig.responseMimeType, 'application/json');
  assert.equal(b.generationConfig.maxOutputTokens, 48000);
});

test('short jobs think low; Claude names map to the fast and deep Gemini models', () => {
  assert.equal(toGemini({ messages: [{ role: 'user', content: 'x' }], thinking: { type: 'between_tools' } }).generationConfig.thinkingConfig.thinkingLevel, 'LOW');
  assert.equal(geminiModel('claude-sonnet-5-5'), GEMINI.fast);
  assert.equal(geminiModel('claude-opus-5-5'), GEMINI.deep);
  assert.equal(geminiModel('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
});

test('a Vertex reply reads like a Claude message: text without thoughts, stop reasons, usage', async () => {
  const m = await fromGemini({ modelVersion: 'gemini-3.5-flash', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"a":1}' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }, 'x');
  assert.equal(m.content.find((b) => b.type === 'text').text, '{"a":1}');
  assert.equal(m.stop_reason, 'end_turn');
  assert.deepEqual([m.usage.input_tokens, m.usage.output_tokens], [100, 15]);
  assert.equal((await fromGemini({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })).stop_reason, 'max_tokens');
  const r = await fromGemini({ candidates: [{ finishReason: 'SAFETY' }] });
  assert.equal(r.stop_reason, 'refusal'); assert.equal(r.stop_details.category, 'safety');
  assert.equal((await fromGemini({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).stop_reason, 'refusal');
});
