/**
 * Slash commands.
 *
 * `/analyze @user` (or just `/analyze` to analyze yourself) runs the full
 * pipeline on demand and posts the report card into the channel where the
 * command was invoked. Works over Socket Mode — no public request URL needed.
 */

import { config } from '../config.js';
import { log } from '../logger.js';

/**
 * Extract a Slack user id from slash-command text. Slack sends a chosen user as
 * an escaped mention `<@U123|name>` when the command has "Escape channels,
 * users, and links" enabled; we also accept a bare `U123` id. Returns null if
 * nothing usable is found (e.g. a plain unescaped name).
 */
export function parseUserId(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const mention = trimmed.match(/^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/i);
  if (mention) return mention[1].toUpperCase();
  const raw = trimmed.match(/^([UW][A-Z0-9]{6,})$/i);
  if (raw) return raw[1].toUpperCase();
  return null;
}

/**
 * Build the `/analyze` handler. Dependencies are injected so it can be unit
 * tested without a live Slack connection.
 */
export function makeAnalyzeHandler({ getUserInfo, processMember, postMessage }) {
  return async function analyzeHandler({ command, ack, respond }) {
    // Slack requires an ack within 3s; the analysis takes longer, so ack first.
    await ack();

    const parsed = parseUserId(command.text);
    if (!parsed && command.text && command.text.trim()) {
      await respond({
        response_type: 'ephemeral',
        text: 'Usage: `/analyze @user` (or `/analyze` to analyze yourself). Pick the user from the autocomplete so Slack sends their ID.',
      });
      return;
    }

    // No argument → analyze whoever ran the command.
    const targetId = parsed || command.user_id;

    try {
      await respond({
        response_type: 'ephemeral',
        text: `🔎 Analyzing <@${targetId}>… the report will post here shortly.`,
      });

      const member = await getUserInfo(targetId);

      // Post into the channel the command ran in; fall back to the configured
      // report channel if the bot isn't a member there.
      const post = async (payload) => {
        try {
          return await postMessage({ ...payload, channel: command.channel_id });
        } catch (error) {
          log.warn('command_post_fallback', error.data?.error || error.message);
          return postMessage({ ...payload, channel: config.slack.channelId });
        }
      };

      const result = await processMember(member, { postMessage: post, force: true });
      log.info('command_analyze_done', { target: targetId, fitScore: result?.analysis?.fitScore });
    } catch (error) {
      log.error('command_analyze_failed', error.message);
      await respond({ response_type: 'ephemeral', text: `⚠️ Couldn't analyze <@${targetId}>: ${error.message}` });
    }
  };
}

export function registerSlackCommands(app, deps) {
  app.command('/analyze', makeAnalyzeHandler(deps));
  log.info('slash_command_registered', '/analyze');
}
