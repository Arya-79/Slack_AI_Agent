/**
 * Small leveled logger.
 *
 * Two things the original inline logger got wrong that matter in production:
 *  1. Errors were written to `console.log` (stdout). Log processors and
 *     container platforms route stderr separately for alerting — errors
 *     belong on `console.error`.
 *  2. There was no way to silence debug noise or drop the log level in prod.
 *
 * Levels: debug < info < warn < error. `LOG_LEVEL` sets the threshold.
 */

import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold() {
  return LEVELS[config.logLevel] ?? LEVELS.info;
}

/**
 * Turn any thrown value into a readable string. Crucially, unwraps
 * `AggregateError` — Node raises one (with an EMPTY `.message`) when it tries
 * several addresses for a host (e.g. localhost → ::1 and 127.0.0.1) and all
 * fail. Logging `error.message` alone would print nothing; this surfaces the
 * real causes (e.g. "ECONNREFUSED 127.0.0.1:5432").
 */
export function describeError(err) {
  if (err == null) return 'unknown error';
  if (Array.isArray(err.errors) && err.errors.length) {
    const causes = err.errors.map((e) => e?.message || String(e)).join('; ');
    return `${err.message || err.name || 'AggregateError'}: ${causes}`;
  }
  return err.message || String(err);
}

function line(level, msg, args) {
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase()}] ${msg}`;
  // Errors and warnings go to stderr; everything else to stdout.
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  sink(prefix, ...args);
}

export const log = {
  debug: (msg, ...args) => {
    if (threshold() <= LEVELS.debug) line('debug', msg, args);
  },
  info: (msg, ...args) => {
    if (threshold() <= LEVELS.info) line('info', msg, args);
  },
  warn: (msg, ...args) => {
    if (threshold() <= LEVELS.warn) line('warn', msg, args);
  },
  error: (msg, ...args) => {
    if (threshold() <= LEVELS.error) line('error', msg, args);
  },
};

export default log;
