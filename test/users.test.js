import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapUser, makeGetUserInfo } from '../src/slack/users.js';

test('mapUser projects the fields the pipeline uses', () => {
  const m = mapUser({
    id: 'U1',
    real_name: 'Ada Lovelace',
    name: 'ada',
    tz: 'Europe/London',
    profile: {
      email: 'ada@acme.io',
      title: 'Engineer',
      first_name: 'Ada',
      last_name: 'Lovelace',
      status_text: 'building',
    },
  });
  assert.equal(m.id, 'U1');
  assert.equal(m.name, 'Ada Lovelace');
  assert.equal(m.email, 'ada@acme.io');
  assert.equal(m.title, 'Engineer');
  assert.equal(m.timezone, 'Europe/London');
  assert.equal(m.profile.firstName, 'Ada');
});

test('mapUser falls back to username when real_name is absent', () => {
  const m = mapUser({ id: 'U2', name: 'bob' });
  assert.equal(m.name, 'bob');
  assert.equal(m.email, null);
  assert.equal(m.title, null);
});

test('mapUser throws on a missing user', () => {
  assert.throws(() => mapUser(undefined), /no user/);
});

test('makeGetUserInfo calls users.info and maps the result', async () => {
  let askedFor;
  const webClient = {
    users: {
      info: async ({ user }) => {
        askedFor = user;
        return { user: { id: user, real_name: 'Grace', name: 'grace', profile: { email: 'g@navy.mil' } } };
      },
    },
  };
  const getUserInfo = makeGetUserInfo(webClient);
  const m = await getUserInfo('U9');
  assert.equal(askedFor, 'U9');
  assert.equal(m.name, 'Grace');
  assert.equal(m.email, 'g@navy.mil');
});
