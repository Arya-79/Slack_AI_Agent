/**
 * Best-effort company lookup from an email domain.
 *
 * This is intentionally light: we fetch the company homepage and read its
 * <title> as a human-readable label. The value is a hint for the LLM, not
 * ground truth, so failures degrade to `null` rather than throwing.
 */

import net from 'node:net';
import axios from 'axios';
import { config } from '../config.js';
import { log } from '../logger.js';
import { assertSafePublicHost, isPrivateOrReservedIp } from './netguard.js';

const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'live.com',
  'msn.com',
]);

/** True when the email is from a consumer provider, not a company. */
export function isPersonalEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return domain ? PERSONAL_DOMAINS.has(domain) : false;
}

/** Extract the domain from an email, or null. */
export function domainFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const domain = email.split('@')[1]?.trim().toLowerCase();
  return domain || null;
}

/** Pull the <title> out of an HTML string, trimmed and length-capped. */
export function extractTitle(html, fallback) {
  const match = typeof html === 'string' ? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null;
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 200) : fallback;
}

export async function getCompanyInfo(domain, { http = axios, resolver } = {}) {
  if (!domain) return null;
  const host = `www.${domain}`;
  try {
    // Resolve + vet the hostname before any socket is opened, and KEEP the
    // vetted address. We then pin the connection to it (below) so axios can't
    // re-resolve the name at connect time to a private IP — that gap is the
    // classic DNS-rebinding SSRF bypass.
    const vetted = await assertSafePublicHost(host, resolver ? { resolver } : {});

    const response = await http.get(`https://${host}`, {
      timeout: config.research.httpTimeoutMs,
      maxContentLength: config.research.maxResponseBytes,
      maxBodyLength: config.research.maxResponseBytes,
      // Following redirects could bounce us to an internal address that the
      // pre-flight check never saw. Disallow them for this untrusted fetch.
      maxRedirects: 0,
      // Any 2xx/3xx is useful; don't throw on 3xx so we can read a landing page.
      validateStatus: (s) => s >= 200 && s < 400,
      headers: { 'User-Agent': 'SlackAIAgent/1.0 (+company-research)' },
      responseType: 'text',
      // Force the socket to the address the guard already vetted. TLS SNI and
      // the Host header still use the hostname (axios derives them from the
      // URL); only the connect target is pinned. Defence-in-depth: re-check.
      lookup: (_hostname, _options, cb) => {
        const address = vetted[0];
        if (!address || isPrivateOrReservedIp(address)) {
          cb(new Error(`refusing to connect to non-public address for ${host}`));
          return;
        }
        cb(null, address, net.isIP(address));
      },
    });

    return {
      type: 'company',
      url: `https://${host}`,
      title: extractTitle(response.data, `Company: ${domain}`),
      content: `Company website for ${domain}`,
    };
  } catch (error) {
    log.debug('company_lookup_failed', domain, error.message);
    return null;
  }
}
