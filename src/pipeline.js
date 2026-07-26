/**
 * The member-processing pipeline: research → analyze → persist → post.
 *
 * This is the heart of the app, extracted from the Slack event handlers so it
 * can be driven by an event, the dev test endpoint, or a test — and so every
 * dependency (research, LLM, DB, Slack) can be injected. It returns the
 * analysis (the original never did, which broke the test endpoint).
 */

import { config } from './config.js';
import { log } from './logger.js';
import { researchMember } from './research/index.js';
import { analyzeMember } from './ai/analyzer.js';
import { buildReport } from './slack/report.js';
import { saveMemberAnalysis, markAsSentToSlack, findRecentAnalysis } from './db.js';

export async function processMember(member, deps = {}) {
  if (!member || !member.name) {
    throw new Error('processMember requires a member with at least a name');
  }

  const research = deps.researchMember || researchMember;
  const analyze = deps.analyzeMember || analyzeMember;
  const save = deps.saveMemberAnalysis || saveMemberAnalysis;
  const markSent = deps.markAsSentToSlack || markAsSentToSlack;
  const findRecent = deps.findRecentAnalysis || findRecentAnalysis;
  const postMessage = deps.postMessage;
  const channelId = deps.channelId || config.slack.channelId;

  // Dedup: a member joining several channels shouldn't spawn several reports.
  if (member.id && !deps.force) {
    const recent = await findRecent(member.id, config.research.dedupeWindowHours);
    if (recent) {
      log.info('member_skip_recent', { member: member.name, previousId: recent.id });
      return { skipped: true, reason: 'recently_analyzed', previousId: recent.id };
    }
  }

  log.info('member_processing', { member: member.name });
  const researchData = await research(member);
  const analysis = await analyze(member, researchData);

  // Persist first. A save failure shouldn't stop us posting to Slack, and a
  // post failure shouldn't lose the analysis — hence they're independent.
  let analysisId = null;
  try {
    analysisId = await save(member, analysis, researchData);
  } catch (error) {
    log.error('member_persist_failed', error.message);
  }

  if (postMessage) {
    const payload = buildReport(member, analysis, researchData);
    payload.channel = channelId;
    await postMessage(payload);
    if (analysisId) {
      await markSent(analysisId).catch((error) => log.warn('mark_sent_failed', error.message));
    }
    log.info('member_posted', { member: member.name, fitScore: analysis.fitScore, analysisId });
  }

  return { skipped: false, analysis, analysisId, researchData };
}
