import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConfigProblems, validateConfig } from '../src/config.js';

function baseConfig(overrides = {}) {
  return {
    port: 3000,
    slack: { botToken: 'x', signingSecret: 'x', appToken: 'x', channelId: 'C1' },
    openai: { apiKey: 'x', temperature: 0.3 },
    database: { url: 'postgres://x' },
    company: {},
    research: {},
    admin: {},
    ...overrides,
  };
}

test('a complete config has no problems', () => {
  assert.deepEqual(findConfigProblems(baseConfig()), []);
});

test('every missing required var is reported at once', () => {
  const problems = findConfigProblems(
    baseConfig({
      slack: {},
      openai: { temperature: 0.3 },
      database: {},
    }),
  );
  // 4 slack + openai key + database url = 6
  assert.equal(problems.length, 6);
  assert.ok(problems.some((p) => p.includes('SLACK_BOT_TOKEN')));
  assert.ok(problems.some((p) => p.includes('OPENAI_API_KEY')));
  assert.ok(problems.some((p) => p.includes('DATABASE_URL')));
});

test('out-of-range temperature and port are flagged', () => {
  const problems = findConfigProblems(
    baseConfig({
      openai: { apiKey: 'x', temperature: 5 },
      port: 70000,
    }),
  );
  assert.ok(problems.some((p) => p.includes('OPENAI_TEMPERATURE')));
  assert.ok(problems.some((p) => p.includes('PORT')));
});

test('validateConfig throws an aggregated, readable error', () => {
  assert.throws(
    () => validateConfig(baseConfig({ slack: {}, openai: { temperature: 0.3 }, database: {} })),
    /Missing required environment variable/,
  );
});

test('validateConfig returns the config when valid', () => {
  const cfg = baseConfig();
  assert.equal(validateConfig(cfg), cfg);
});
