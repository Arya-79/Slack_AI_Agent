/**
 * Builds the Slack "new member analysis" card (Block Kit).
 *
 * Pure and side-effect free: given a member + analysis, it returns the exact
 * `chat.postMessage` payload. That makes the layout unit-testable without a
 * Slack connection, and keeps the transport code (events.js) tiny.
 *
 * Every string is length-capped to Slack's Block Kit limits. Slack rejects the
 * ENTIRE message with `invalid_blocks` if any single field overflows, so an
 * over-long member name or a verbose LLM response would otherwise silently drop
 * the whole report.
 */

// Slack Block Kit hard limits (characters).
const LIMIT = { HEADER: 150, SECTION: 3000, FIELD: 2000 };

const truncate = (value, max) => {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Traffic-light color for the attachment, keyed off the fit score. */
export function colorForScore(score) {
  if (score >= 80) return '#36a64f'; // green — strong fit
  if (score >= 60) return '#ffb84d'; // amber
  if (score >= 40) return '#ff9500'; // orange
  return '#ff4444'; // red — weak fit
}

function bulletSection(title, items) {
  const body = `*${title}:*\n${items.map((i) => `• ${i}`).join('\n')}`;
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: truncate(body, LIMIT.SECTION) },
  };
}

export function buildReport(member, analysis, researchData = []) {
  const score = analysis.fitScore;
  const nameWithMention = member.id ? `${member.name} (<@${member.id}>)` : member.name;

  const blocks = [
    {
      type: 'header',
      // Reserve room for the "🔍 New Member: " prefix under the 150 cap.
      text: { type: 'plain_text', text: `🔍 New Member: ${truncate(member.name, LIMIT.HEADER - 20)}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Fit Score:*\n${score}/100` },
        { type: 'mrkdwn', text: truncate(`*Member:*\n${nameWithMention}`, LIMIT.FIELD) },
        { type: 'mrkdwn', text: truncate(`*Email:*\n${member.email || '_Not provided_'}`, LIMIT.FIELD) },
        { type: 'mrkdwn', text: truncate(`*Title:*\n${member.title || '_Not provided_'}`, LIMIT.FIELD) },
      ],
    },
  ];

  if (analysis.degraded) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '⚠️ _This analysis is degraded — the AI step failed or returned limited data. Review manually._',
        },
      ],
    });
  }

  if (Array.isArray(analysis.insights) && analysis.insights.length) {
    blocks.push(bulletSection('Insights', analysis.insights));
  }
  if (Array.isArray(analysis.recommendations) && analysis.recommendations.length) {
    blocks.push(bulletSection('Recommendations', analysis.recommendations));
  }

  // Surface the research links that fed the analysis, so a human can verify.
  const links = (researchData || []).filter((r) => r?.url).map((r) => `<${r.url}|${r.title || r.type}>`);
  if (links.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(`*Sources:*\n${links.join('  ·  ')}`, LIMIT.SECTION) },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `📊 Analyzed ${new Date().toISOString()}` }],
  });

  return {
    channel: undefined, // filled in by the caller from config
    text: truncate(`New member analysis: ${member.name} (${score}/100)`, LIMIT.SECTION), // notification fallback
    attachments: [{ color: colorForScore(score), blocks }],
  };
}
