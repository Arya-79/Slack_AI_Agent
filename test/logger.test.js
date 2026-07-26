import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../src/logger.js';

test('describeError returns a plain error message', () => {
  assert.equal(describeError(new Error('boom')), 'boom');
});

test('describeError unwraps AggregateError with an empty message', () => {
  const agg = new AggregateError(
    [new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')],
    '',
  );
  const out = describeError(agg);
  assert.match(out, /ECONNREFUSED ::1:5432/);
  assert.match(out, /ECONNREFUSED 127\.0\.0\.1:5432/);
  assert.ok(out.length > 0);
});

test('describeError handles null/undefined and non-errors', () => {
  assert.equal(describeError(null), 'unknown error');
  assert.equal(describeError(undefined), 'unknown error');
  assert.equal(describeError('just a string'), 'just a string');
});
