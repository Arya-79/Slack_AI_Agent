/**
 * Slack user helpers.
 *
 * `mapUser` is the pure projection from Slack's verbose `users.info` payload
 * down to the handful of fields the pipeline actually uses — kept separate (and
 * testable) from the network call that fetches it.
 */

export function mapUser(user) {
  if (!user) throw new Error('mapUser received no user');
  return {
    id: user.id,
    name: user.real_name || user.name || 'Unknown member',
    username: user.name,
    email: user.profile?.email || null,
    title: user.profile?.title || null,
    timezone: user.tz || null,
    profile: {
      firstName: user.profile?.first_name || null,
      lastName: user.profile?.last_name || null,
      statusText: user.profile?.status_text || null,
    },
  };
}

/** Bind a `users.info` fetcher to a Slack WebClient. */
export function makeGetUserInfo(webClient) {
  return async function getUserInfo(userId) {
    const result = await webClient.users.info({ user: userId });
    return mapUser(result.user);
  };
}
