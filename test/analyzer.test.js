import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampScore, buildResearchSummary, parseAnalysis, analyzeMember } from '../src/ai/analyzer.js';

test('clampScore keeps a real 0 (does not coerce to 50)', () => {
  assert.equal(clampScore(0), 0);
});

test('clampScore rounds and clamps into [0,100]', () => {
  assert.equal(clampScore(150), 100);
  assert.equal(clampScore(-5), 0);
  assert.equal(clampScore(72.6), 73);
});

test('clampScore falls back to 50 only for non-numbers', () => {
  assert.equal(clampScore('nope'), 50);
  assert.equal(clampScore(undefined), 50);
  assert.equal(clampScore(null), 50);
});

test('buildResearchSummary joins with real newlines', () => {
  const out = buildResearchSummary([
    { title: 'Acme', content: 'a company' },
    { title: 'GitHub', content: 'a repo' },
  ]);
  assert.ok(out.includes('\n'));
  assert.ok(!out.includes('\\n'));
});

test('buildResearchSummary handles empty input', () => {
  assert.match(buildResearchSummary([]), /No external research/i);
  assert.match(buildResearchSummary(undefined), /No external research/i);
});

test('parseAnalysis reads plain JSON', () => {
  const out = parseAnalysis('{"fitScore":80,"insights":["x"],"recommendations":["y"]}');
  assert.equal(out.fitScore, 80);
  assert.deepEqual(out.insights, ['x']);
  assert.equal(out.degraded, false);
});

test('parseAnalysis tolerates code fences and surrounding prose', () => {
  const raw = 'Here you go:\n```json\n{"fitScore":42,"insights":["a","b"],"recommendations":["c"]}\n```\nThanks!';
  const out = parseAnalysis(raw);
  assert.equal(out.fitScore, 42);
});

test('parseAnalysis degrades safely on garbage', () => {
  const out = parseAnalysis('the model said no');
  assert.equal(out.degraded, true);
  assert.equal(out.fitScore, 50);
});

test('analyzeMember retries then succeeds with an injected model', async () => {
  let calls = 0;
  const model = {
    invoke: async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient 429');
      return { content: '{"fitScore":90,"insights":["strong"],"recommendations":["reach out"]}' };
    },
  };
  const out = await analyzeMember({ name: 'Ada', email: 'ada@acme.io', title: 'CTO' }, [], { model });
  assert.equal(calls, 2);
  assert.equal(out.fitScore, 90);
});

test('analyzeMember returns a degraded result after exhausting retries', async () => {
  const model = {
    invoke: async () => {
      throw new Error('always fails');
    },
  };
  const out = await analyzeMember({ name: 'Bo' }, [], { model });
  assert.equal(out.degraded, true);
  assert.equal(out.fitScore, 50);
});
