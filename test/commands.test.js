import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUserId, makeAnalyzeHandler } from '../src/slack/commands.js';

test('parseUserId reads an escaped mention', () => {
  assert.equal(parseUserId('<@U012ABC|grace>'), 'U012ABC');
  assert.equal(parseUserId('<@U012ABC>'), 'U012ABC');
});

test('parseUserId reads a bare user id', () => {
  assert.equal(parseUserId('U012ABC34'), 'U012ABC34');
  assert.equal(parseUserId('  W012ABC34  '), 'W012ABC34');
});

test('parseUserId returns null for a plain name or empty text', () => {
  assert.equal(parseUserId('grace'), null);
  assert.equal(parseUserId(''), null);
  assert.equal(parseUserId(undefined), null);
});

function harness(overrides = {}) {
  const calls = { ack: 0, responds: [], processed: [] };
  const deps = {
    getUserInfo: async (id) => ({ id, name: `User ${id}` }),
    processMember: async (member, opts) => {
      calls.processed.push({ member, opts });
      return { analysis: { fitScore: 80 } };
    },
    postMessage: async () => ({ ok: true }),
    ...overrides,
  };
  const handler = makeAnalyzeHandler(deps);
  const ctx = (text, extra = {}) => ({
    command: { text, user_id: 'U_SELF', channel_id: 'C_HERE', ...extra },
    ack: async () => {
      calls.ack += 1;
    },
    respond: async (msg) => calls.responds.push(msg),
  });
  return { handler, ctx, calls };
}

test('/analyze @user analyzes the mentioned user and forces a fresh run', async () => {
  const { handler, ctx, calls } = harness();
  await handler(ctx('<@U0123ABC|grace>'));
  assert.equal(calls.ack, 1);
  assert.equal(calls.processed.length, 1);
  assert.equal(calls.processed[0].member.id, 'U0123ABC');
  assert.equal(calls.processed[0].opts.force, true);
});

test('/analyze with no argument analyzes the command issuer', async () => {
  const { handler, ctx, calls } = harness();
  await handler(ctx(''));
  assert.equal(calls.processed[0].member.id, 'U_SELF');
});

test('/analyze with an unparseable name shows usage and does not analyze', async () => {
  const { handler, ctx, calls } = harness();
  await handler(ctx('grace'));
  assert.equal(calls.processed.length, 0);
  assert.match(calls.responds.at(-1).text, /Usage/);
});

test('/analyze reports an ephemeral error when the pipeline throws', async () => {
  const { handler, ctx, calls } = harness({
    processMember: async () => {
      throw new Error('OpenAI down');
    },
  });
  await handler(ctx('<@U0123ABC|grace>'));
  assert.match(calls.responds.at(-1).text, /Couldn't analyze/);
  assert.match(calls.responds.at(-1).text, /OpenAI down/);
});
