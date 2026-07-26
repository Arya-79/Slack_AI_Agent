/**
 * Best-effort GitHub lookup by display name.
 *
 * Searching GitHub by a person's real name is inherently ambiguous — many
 * people share a name, and the top hit is often the wrong person. Rather than
 * silently attach that as fact (which biases the LLM's judgement), we label it
 * explicitly as an *unverified possible match* and carry a confidence flag so
 * downstream code and readers treat it with appropriate skepticism.
 */

import axios from 'axios';
import { config } from '../config.js';
import { log } from '../logger.js';

export async function getGitHubInfo(name, { http = axios } = {}) {
  const query = (name || '').trim();
  if (!query) return null;
  try {
    const response = await http.get(
      `https://api.github.com/search/users?q=${encodeURIComponent(query)}+type:user&per_page=1`,
      {
        timeout: config.research.httpTimeoutMs,
        headers: {
          'User-Agent': 'SlackAIAgent/1.0 (+github-research)',
          Accept: 'application/vnd.github+json',
        },
      },
    );

    const items = response.data?.items;
    if (!Array.isArray(items) || items.length === 0) return null;

    const totalMatches = response.data.total_count ?? items.length;
    const user = items[0];
    return {
      type: 'github',
      url: user.html_url,
      // Make the uncertainty legible everywhere this flows.
      title: `GitHub (possible match): ${user.login}`,
      content:
        `Unverified — GitHub search returned ${totalMatches} account(s) for the name "${query}"; ` +
        `showing the top result "${user.login}". May not be the same person.`,
      confidence: totalMatches === 1 ? 'medium' : 'low',
    };
  } catch (error) {
    log.debug('github_lookup_failed', query, error.message);
    return null;
  }
}
