import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processMember } from '../src/pipeline.js';

function fakes(overrides = {}) {
  const posted = [];
  const saved = [];
  return {
    posted,
    saved,
    deps: {
      researchMember: async () => [],
      analyzeMember: async () => ({ fitScore: 77, insights: ['i'], recommendations: ['r'] }),
      saveMemberAnalysis: async (m, a) => {
        saved.push({ m, a });
        return 123;
      },
      markAsSentToSlack: async () => {},
      findRecentAnalysis: async () => null,
      postMessage: async (payload) => posted.push(payload),
      channelId: 'C_TEST',
      ...overrides,
    },
  };
}

test('processMember runs the full path and returns the analysis', async () => {
  const { deps, posted, saved } = fakes();
  const result = await processMember({ id: 'U1', name: 'Ada', email: 'ada@acme.io' }, deps);

  assert.equal(result.skipped, false);
  assert.equal(result.analysis.fitScore, 77);
  assert.equal(result.analysisId, 123);
  assert.equal(saved.length, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].channel, 'C_TEST');
  assert.match(posted[0].text, /Ada/);
});

test('processMember dedupes a recently-analyzed member', async () => {
  const { deps, posted } = fakes({ findRecentAnalysis: async () => ({ id: 9 }) });
  const result = await processMember({ id: 'U1', name: 'Ada' }, deps);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'recently_analyzed');
  assert.equal(posted.length, 0); // nothing posted for a duplicate
});

test('processMember with force bypasses dedup', async () => {
  const { deps, posted } = fakes({ findRecentAnalysis: async () => ({ id: 9 }) });
  const result = await processMember({ id: 'U1', name: 'Ada' }, { ...deps, force: true });

  assert.equal(result.skipped, false);
  assert.equal(posted.length, 1);
});

test('processMember still posts when persistence fails', async () => {
  const { deps, posted } = fakes({
    saveMemberAnalysis: async () => {
      throw new Error('db down');
    },
  });
  const result = await processMember({ id: 'U1', name: 'Ada' }, deps);

  assert.equal(result.analysisId, null);
  assert.equal(posted.length, 1); // analysis reaches Slack even if the DB write failed
});

test('processMember rejects a member with no name', async () => {
  const { deps } = fakes();
  await assert.rejects(() => processMember({ id: 'U1' }, deps), /name/);
});
