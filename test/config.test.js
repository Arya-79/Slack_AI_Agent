import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConfigProblems, validateConfig, resolveLlm } from '../src/config.js';

function baseConfig(overrides = {}) {
  return {
    port: 3000,
    slack: { botToken: 'x', signingSecret: 'x', appToken: 'x', channelId: 'C1' },
    llm: {
      provider: 'openai',
      model: null,
      temperature: 0.3,
      maxRetries: 3,
      openaiApiKey: 'x',
      groqApiKey: null,
      ollamaBaseUrl: 'http://localhost:11434/v1',
    },
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
      llm: { provider: 'openai', temperature: 0.3 },
      database: {},
    }),
  );
  // 4 slack + database url + the openai key = 6
  assert.equal(problems.length, 6);
  assert.ok(problems.some((p) => p.includes('SLACK_BOT_TOKEN')));
  assert.ok(problems.some((p) => p.includes('OPENAI_API_KEY')));
  assert.ok(problems.some((p) => p.includes('DATABASE_URL')));
});

test('groq provider requires GROQ_API_KEY', () => {
  const problems = findConfigProblems(baseConfig({ llm: { provider: 'groq', temperature: 0.3, groqApiKey: null } }));
  assert.ok(problems.some((p) => p.includes('GROQ_API_KEY')));
});

test('ollama provider needs no API key', () => {
  const problems = findConfigProblems(
    baseConfig({ llm: { provider: 'ollama', temperature: 0.3, ollamaBaseUrl: 'http://localhost:11434/v1' } }),
  );
  assert.deepEqual(problems, []);
});

test('an unknown provider is rejected', () => {
  const problems = findConfigProblems(baseConfig({ llm: { provider: 'bogus', temperature: 0.3 } }));
  assert.ok(problems.some((p) => p.includes('LLM_PROVIDER must be one of')));
});

test('out-of-range temperature and port are flagged', () => {
  const problems = findConfigProblems(
    baseConfig({
      llm: { provider: 'openai', openaiApiKey: 'x', temperature: 5 },
      port: 70000,
    }),
  );
  assert.ok(problems.some((p) => p.includes('LLM_TEMPERATURE')));
  assert.ok(problems.some((p) => p.includes('PORT')));
});

test('validateConfig throws an aggregated, readable error', () => {
  assert.throws(
    () => validateConfig(baseConfig({ slack: {}, llm: { provider: 'openai', temperature: 0.3 }, database: {} })),
    /Missing required environment variable/,
  );
});

test('validateConfig returns the config when valid', () => {
  const cfg = baseConfig();
  assert.equal(validateConfig(cfg), cfg);
});

test('resolveLlm maps openai to the OpenAI defaults', () => {
  const t = resolveLlm(baseConfig());
  assert.deepEqual(t, { provider: 'openai', apiKey: 'x', model: 'gpt-4o-mini', baseURL: null });
});

test('resolveLlm maps groq to its base URL, model, and key', () => {
  const t = resolveLlm(baseConfig({ llm: { provider: 'groq', groqApiKey: 'gk', temperature: 0.3 } }));
  assert.equal(t.provider, 'groq');
  assert.equal(t.apiKey, 'gk');
  assert.equal(t.model, 'llama-3.3-70b-versatile');
  assert.equal(t.baseURL, 'https://api.groq.com/openai/v1');
});

test('resolveLlm maps ollama to a local base URL and a dummy key', () => {
  const t = resolveLlm(
    baseConfig({ llm: { provider: 'ollama', temperature: 0.3, ollamaBaseUrl: 'http://host:11434/v1' } }),
  );
  assert.equal(t.provider, 'ollama');
  assert.equal(t.apiKey, 'ollama');
  assert.equal(t.model, 'llama3.1');
  assert.equal(t.baseURL, 'http://host:11434/v1');
});

test('resolveLlm honours a model override and falls back to openai for unknown providers', () => {
  assert.equal(
    resolveLlm(baseConfig({ llm: { provider: 'groq', groqApiKey: 'g', model: 'mixtral', temperature: 0.3 } })).model,
    'mixtral',
  );
  assert.equal(
    resolveLlm(baseConfig({ llm: { provider: 'bogus', openaiApiKey: 'x', temperature: 0.3 } })).provider,
    'openai',
  );
});
