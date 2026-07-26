/**
 * Wires Slack events to the processing pipeline.
 *
 * Two fixes over the original live here:
 *  1. The `member_joined_channel` guard now reads `channel_type` (the real
 *     field) instead of `channeltype`, so channel joins are actually handled.
 *  2. The global `app.error` handler is registered once here, not re-registered
 *     inside an event callback on every event.
 */

import { log } from '../logger.js';

export function registerSlackEvents(slackApp, { getUserInfo, processMember }) {
  slackApp.event('team_join', async ({ event }) => {
    try {
      // In `team_join`, `event.user` is the full user object.
      const userId = event.user?.id || event.user;
      const name = event.user?.real_name || event.user?.name || userId;
      log.info('event_team_join', { member: name });
      const member = await getUserInfo(userId);
      await processMember(member);
    } catch (error) {
      log.error('team_join_failed', error.message);
    }
  });

  slackApp.event('member_joined_channel', async ({ event }) => {
    try {
      // Only public channels ('C'). Ignore private groups/DMs. Missing field
      // is treated as public so a payload change can't silently disable this.
      if (event.channel_type && event.channel_type !== 'C') {
        log.debug('member_joined_channel_skipped', { channelType: event.channel_type });
        return;
      }
      log.info('event_member_joined_channel', { user: event.user, channel: event.channel });
      // Here `event.user` is a user ID string.
      const member = await getUserInfo(event.user);
      await processMember(member);
    } catch (error) {
      log.error('member_joined_channel_failed', error.message);
    }
  });

  // Register once, at setup — not inside a per-event handler.
  slackApp.error(async (error) => {
    log.error('slack_app_error', error?.message || String(error));
  });
}
