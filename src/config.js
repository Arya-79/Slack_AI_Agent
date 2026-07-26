/**
 * Centralized, validated application configuration.
 *
 * Every environment variable the app reads is declared here once, given a
 * sensible default where one exists, and validated at startup. Reading config
 * from a single typed object (instead of sprinkling `process.env.X` across the
 * codebase) means a missing or malformed value fails loudly on boot with a
 * clear message — never as a cryptic `undefined` deep inside a request.
 */

import dotenv from 'dotenv';

dotenv.config();

const bool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const env = process.env;

export const config = {
  nodeEnv: env.NODE_ENV || 'production',
  isDev: (env.NODE_ENV || 'production') === 'development',
  logLevel: env.LOG_LEVEL || 'info',
  port: int(env.PORT, 3000),

  slack: {
    botToken: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    appToken: env.SLACK_APP_TOKEN,
    channelId: env.SLACK_PRIVATE_CHANNEL_ID,
  },

  // The analysis LLM. `provider` picks where the model runs; all three are
  // spoken to through the OpenAI-compatible API, so no extra SDKs are needed:
  //   openai — OpenAI (needs OPENAI_API_KEY, paid)
  //   groq   — Groq (needs GROQ_API_KEY, free tier, no card, very fast)
  //   ollama — a local Ollama server (no key, fully offline)
  llm: {
    provider: (env.LLM_PROVIDER || 'openai').toLowerCase(),
    // Optional model override; each provider has a sensible default otherwise.
    model: env.LLM_MODEL || env.OPENAI_MODEL || null,
    temperature: Number.parseFloat(env.LLM_TEMPERATURE ?? env.OPENAI_TEMPERATURE ?? '0.3'),
    maxRetries: int(env.LLM_MAX_RETRIES ?? env.OPENAI_MAX_RETRIES, 3),
    openaiApiKey: env.OPENAI_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  },

  database: {
    url: env.DATABASE_URL,
    // Render and most managed Postgres providers terminate TLS with a
    // certificate the container's trust store doesn't know about. This is
    // safe there, but let it be disabled for a locally-trusted database.
    ssl: bool(env.DATABASE_SSL, true),
    maxConnections: int(env.DATABASE_POOL_MAX, 10),
  },

  company: {
    name: env.COMPANY_NAME || 'Your Company',
    product: env.COMPANY_PRODUCT || 'Your Product',
  },

  research: {
    // A member joining several channels shouldn't be analyzed once per
    // channel. Skip re-analysis if we've already looked at them recently.
    dedupeWindowHours: int(env.DEDUPE_WINDOW_HOURS, 24),
    httpTimeoutMs: int(env.RESEARCH_HTTP_TIMEOUT_MS, 5000),
    // Cap the bytes we pull from an untrusted company website so a hostile
    // or accidentally huge page can't exhaust memory or the regex engine.
    maxResponseBytes: int(env.RESEARCH_MAX_RESPONSE_BYTES, 512 * 1024),
    enabled: bool(env.RESEARCH_ENABLED, true),
  },

  admin: {
    // When set, the read-only admin API requires this key via `X-API-Key`.
    // Unset means the API is open — fine for local dev, not for production.
    apiKey: env.ADMIN_API_KEY || null,
  },
};

// Per-provider defaults. All are OpenAI-compatible endpoints.
const LLM_PROVIDERS = {
  openai: { defaultModel: 'gpt-4o-mini', baseURL: null, keyName: 'OPENAI_API_KEY' },
  groq: { defaultModel: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY' },
  ollama: { defaultModel: 'llama3.1', baseURL: null, keyName: null }, // baseURL from ollamaBaseUrl; no key
};

/**
 * Resolve the active LLM into concrete connection settings for a ChatOpenAI
 * client: which key, which model, which base URL. Pure and testable.
 */
export function resolveLlm(cfg = config) {
  const provider = LLM_PROVIDERS[cfg.llm.provider] ? cfg.llm.provider : 'openai';
  const spec = LLM_PROVIDERS[provider];
  const model = cfg.llm.model || spec.defaultModel;
  if (provider === 'groq') {
    return { provider, apiKey: cfg.llm.groqApiKey, model, baseURL: spec.baseURL };
  }
  if (provider === 'ollama') {
    // Ollama ignores the key but the client requires a non-empty string.
    return { provider, apiKey: 'ollama', model, baseURL: cfg.llm.ollamaBaseUrl };
  }
  return { provider, apiKey: cfg.llm.openaiApiKey, model, baseURL: spec.baseURL };
}

/**
 * Return the list of problems with the current configuration.
 * Pure and side-effect free so it can be unit tested.
 */
export function findConfigProblems(cfg = config) {
  const problems = [];

  const required = [
    ['SLACK_BOT_TOKEN', cfg.slack.botToken],
    ['SLACK_SIGNING_SECRET', cfg.slack.signingSecret],
    ['SLACK_APP_TOKEN', cfg.slack.appToken],
    ['SLACK_PRIVATE_CHANNEL_ID', cfg.slack.channelId],
    ['DATABASE_URL', cfg.database.url],
  ];

  for (const [name, value] of required) {
    if (!value || String(value).trim() === '') {
      problems.push(`Missing required environment variable: ${name}`);
    }
  }

  // The LLM key requirement depends on the chosen provider.
  if (!LLM_PROVIDERS[cfg.llm.provider]) {
    problems.push(`LLM_PROVIDER must be one of: ${Object.keys(LLM_PROVIDERS).join(', ')} (got "${cfg.llm.provider}")`);
  } else {
    const keyName = LLM_PROVIDERS[cfg.llm.provider].keyName;
    const target = resolveLlm(cfg);
    if (keyName && (!target.apiKey || String(target.apiKey).trim() === '')) {
      problems.push(`Missing required environment variable: ${keyName} (needed for LLM_PROVIDER=${cfg.llm.provider})`);
    }
  }

  if (!Number.isFinite(cfg.llm.temperature) || cfg.llm.temperature < 0 || cfg.llm.temperature > 2) {
    problems.push(`LLM_TEMPERATURE must be a number between 0 and 2 (got "${cfg.llm.temperature}")`);
  }

  if (!Number.isFinite(cfg.port) || cfg.port <= 0 || cfg.port > 65535) {
    problems.push(`PORT must be a valid port number (got "${cfg.port}")`);
  }

  return problems;
}

/**
 * Throw a single, readable error if the configuration is invalid.
 * Call once at startup, before any connections are opened.
 */
export function validateConfig(cfg = config) {
  const problems = findConfigProblems(cfg);
  if (problems.length > 0) {
    throw new Error(
      `Invalid configuration — fix these and restart:\n` +
        problems.map((p) => `  • ${p}`).join('\n') +
        `\n\nSee .env.example for the full list of variables.`,
    );
  }
  return cfg;
}

// The always-required variables (the LLM key is additionally required based on
// the chosen provider — see findConfigProblems).
export const REQUIRED_ENV = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'SLACK_PRIVATE_CHANNEL_ID',
  'DATABASE_URL',
];

export default config;
