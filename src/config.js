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

  openai: {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: Number.parseFloat(env.OPENAI_TEMPERATURE ?? '0.3'),
    maxRetries: int(env.OPENAI_MAX_RETRIES, 3),
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

/**
 * Groups of settings that must be present for the app to function. Validated
 * together so the operator sees every problem at once, not one reboot at a time.
 */
const REQUIRED = [
  ['SLACK_BOT_TOKEN', config.slack.botToken],
  ['SLACK_SIGNING_SECRET', config.slack.signingSecret],
  ['SLACK_APP_TOKEN', config.slack.appToken],
  ['SLACK_PRIVATE_CHANNEL_ID', config.slack.channelId],
  ['OPENAI_API_KEY', config.openai.apiKey],
  ['DATABASE_URL', config.database.url],
];

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
    ['OPENAI_API_KEY', cfg.openai.apiKey],
    ['DATABASE_URL', cfg.database.url],
  ];

  for (const [name, value] of required) {
    if (!value || String(value).trim() === '') {
      problems.push(`Missing required environment variable: ${name}`);
    }
  }

  if (!Number.isFinite(cfg.openai.temperature) || cfg.openai.temperature < 0 || cfg.openai.temperature > 2) {
    problems.push(`OPENAI_TEMPERATURE must be a number between 0 and 2 (got "${cfg.openai.temperature}")`);
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

// Kept for reference/tests: the canonical list of hard-required variables.
export const REQUIRED_ENV = REQUIRED.map(([name]) => name);

export default config;
