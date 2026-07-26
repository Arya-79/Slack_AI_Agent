import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

let server;
let base;

const stub = {
  getStats: async () => ({
    total: 2,
    sentToSlack: 1,
    avgFitScore: 65,
    distribution: { hot: 1, warm: 1, lukewarm: 0, cold: 0 },
    lastAnalyzedAt: null,
  }),
  listAnalyses: async ({ limit, offset }) => ({ items: [{ id: 1, member_name: 'Ada' }], total: 1, limit, offset }),
  getAnalysis: async (id) => (id === 1 ? { id: 1, member_name: 'Ada' } : null),
};

before(async () => {
  const app = createServer(stub);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('GET /health returns healthy', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'healthy');
});

test('GET /api/stats returns aggregates', async () => {
  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, 2);
  assert.equal(body.avgFitScore, 65);
});

test('GET /api/analyses passes through pagination', async () => {
  const res = await fetch(`${base}/api/analyses?limit=5&offset=10`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.limit, 5);
  assert.equal(body.offset, 10);
  assert.equal(body.items[0].member_name, 'Ada');
});

test('GET /api/analyses/:id returns 404 for a missing row', async () => {
  const res = await fetch(`${base}/api/analyses/999`);
  assert.equal(res.status, 404);
});

test('GET /api/analyses/:id returns 400 for a non-numeric id', async () => {
  const res = await fetch(`${base}/api/analyses/abc`);
  assert.equal(res.status, 400);
});

test('GET /api/analyses/:id returns a row when found', async () => {
  const res = await fetch(`${base}/api/analyses/1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.member_name, 'Ada');
});
