/**
 * Standalone database connectivity check: `npm run db:check`.
 *
 * Connects using DATABASE_URL and runs `SELECT 1`, trying SSL both ways and
 * reporting a specific reason on failure. Prints only non-secret parts of the
 * connection string — never the username or password.
 */

import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL || '';
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

try {
  const u = new URL(url);
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  const internal = !isLocal && !u.hostname.includes('.');
  console.log('--- DATABASE_URL (no credentials) ---');
  console.log('host    :', u.hostname);
  console.log('port    :', u.port || '5432 (default)');
  console.log('database:', u.pathname.slice(1) || '(none)');
  console.log('sslmode :', u.searchParams.get('sslmode') || '(not set)');
  if (internal)
    console.log('note    : host has no dot — looks like a Render INTERNAL URL, which only works inside Render.');
} catch (e) {
  console.error('DATABASE_URL is not a valid URL:', e.message);
  process.exit(1);
}

const { Client } = pg;
const attempts = [
  { label: 'ssl on (no verify)', ssl: { rejectUnauthorized: false } },
  { label: 'ssl off', ssl: false },
];

for (const { label, ssl } of attempts) {
  const client = new Client({ connectionString: url, ssl, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const r = await client.query('select 1 as ok');
    console.log(`\n✅ Connected [${label}] — SELECT returned ${r.rows[0].ok}. Database is reachable.`);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`\n❌ [${label}] ${e.code ? e.code + ' ' : ''}${e.message}`);
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

console.error(
  '\nCould not connect. Common causes:\n' +
    '  • The database is suspended/expired (Render free tier) — check its status in the Render dashboard.\n' +
    '  • Wrong or rotated DATABASE_URL — copy the current External URL from Render.\n' +
    '  • Using an internal URL from outside Render.\n' +
    '  • Network/firewall blocking outbound 5432.',
);
process.exit(1);
