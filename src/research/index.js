/**
 * Research orchestration.
 *
 * Gathers lightweight public signals about a new member to give the LLM a bit
 * of context beyond their bare Slack profile. Every step is best-effort and
 * independent: one lookup failing never blocks the others or the analysis.
 */

import { config } from '../config.js';
import { log } from '../logger.js';
import { getCompanyInfo, isPersonalEmail, domainFromEmail } from './company.js';
import { getGitHubInfo } from './github.js';

/**
 * @returns {Promise<Array<{type,url,title,content,confidence?}>>}
 */
export async function researchMember(member, deps = {}) {
  if (!config.research.enabled) return [];

  const getCompany = deps.getCompanyInfo || getCompanyInfo;
  const getGitHub = deps.getGitHubInfo || getGitHubInfo;

  const tasks = [];

  const domain = domainFromEmail(member.email);
  if (domain && !isPersonalEmail(member.email)) {
    tasks.push(getCompany(domain));
    if (member.name) tasks.push(getGitHub(member.name));
  }

  if (tasks.length === 0) return [];

  // Run lookups concurrently; keep whatever succeeds.
  const settled = await Promise.allSettled(tasks);
  const results = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value) results.push(outcome.value);
    else if (outcome.status === 'rejected') log.debug('research_task_failed', outcome.reason?.message);
  }
  return results;
}
