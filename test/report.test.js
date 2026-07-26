import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, colorForScore } from '../src/slack/report.js';

test('colorForScore returns distinct bands (the original 40-79 red bug)', () => {
  assert.equal(colorForScore(95), '#36a64f'); // green
  assert.equal(colorForScore(80), '#36a64f');
  assert.equal(colorForScore(79), '#ffb84d'); // amber
  assert.equal(colorForScore(60), '#ffb84d');
  assert.equal(colorForScore(59), '#ff9500'); // orange
  assert.equal(colorForScore(40), '#ff9500');
  assert.equal(colorForScore(39), '#ff4444'); // red
  assert.equal(colorForScore(0), '#ff4444');
});

test('buildReport sets the attachment color from fitScore', () => {
  const r = buildReport({ name: 'Jo' }, { fitScore: 70, insights: [], recommendations: [] });
  assert.equal(r.attachments[0].color, '#ffb84d');
});

test('buildReport includes a member mention when an id is present', () => {
  const r = buildReport({ id: 'U123', name: 'Jo' }, { fitScore: 50, insights: [], recommendations: [] });
  assert.ok(JSON.stringify(r).includes('<@U123>'));
});

test('buildReport carries the notification fallback text', () => {
  const r = buildReport({ name: 'Jo' }, { fitScore: 88, insights: [], recommendations: [] });
  assert.match(r.text, /Jo.*88\/100/);
});

test('buildReport renders source links from research data', () => {
  const r = buildReport({ name: 'Jo' }, { fitScore: 60, insights: ['i'], recommendations: ['r'] }, [
    { url: 'https://acme.io', title: 'Acme' },
  ]);
  const json = JSON.stringify(r);
  assert.ok(json.includes('acme.io'));
  assert.ok(json.includes('Sources'));
});

test('buildReport shows a warning for degraded analyses', () => {
  const r = buildReport({ name: 'Jo' }, { fitScore: 50, insights: ['x'], recommendations: ['y'], degraded: true });
  assert.match(JSON.stringify(r), /degraded/i);
});

test('buildReport tolerates missing email/title', () => {
  const r = buildReport({ name: 'Jo' }, { fitScore: 50, insights: [], recommendations: [] });
  assert.match(JSON.stringify(r), /Not provided/);
});

test("buildReport caps the header at Slack's 150-char limit", () => {
  const longName = 'X'.repeat(500);
  const r = buildReport({ name: longName }, { fitScore: 50, insights: [], recommendations: [] });
  const header = r.attachments[0].blocks.find((b) => b.type === 'header');
  assert.ok(header.text.text.length <= 150, `header was ${header.text.text.length} chars`);
});

test("buildReport caps a verbose section at Slack's 3000-char limit", () => {
  const insights = Array.from({ length: 50 }, (_, i) => `Insight ${i} ` + 'y'.repeat(200));
  const r = buildReport({ name: 'Jo' }, { fitScore: 50, insights, recommendations: [] });
  const section = r.attachments[0].blocks.find((b) => b.type === 'section' && b.text?.text?.startsWith('*Insights:*'));
  assert.ok(section.text.text.length <= 3000, `section was ${section.text.text.length} chars`);
});
