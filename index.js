/**
 * Entry point.
 *
 * Thin on purpose: construct the agent, wire process signals, start. All logic
 * lives in ./src. See src/agent.js for the composition root.
 */

import { SlackAIAgent } from './src/agent.js';
import { log, describeError } from './src/logger.js';

let agent;
try {
  // The constructor validates configuration and fails fast on missing env.
  agent = new SlackAIAgent();
} catch (error) {
  // A config error is an operator problem, not a bug — show the message
  // plainly (no stack trace) and exit.
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('signal_received', signal);
  await agent.stop();
  process.exit(code);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Last-resort safety nets so an unexpected async error doesn't silently kill
// the process (or leave it wedged) without a log line.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled_rejection', describeError(reason));
});
process.on('uncaughtException', (error) => {
  log.error('uncaught_exception', describeError(error));
  // Exit non-zero so supervisors (Docker/systemd/orchestrators) treat this as
  // a crash and restart/alert — a clean 0 would mask the failure.
  shutdown('uncaughtException', 1);
});

agent.start().catch((error) => {
  log.error('startup_failed', describeError(error));
  // The most common startup failure is an unreachable database — nudge the
  // operator toward the fast check instead of a bare stack.
  console.error('\nHint: is the database reachable? Run  npm run db:check\n');
  process.exit(1);
});

export default agent;
