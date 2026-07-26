/**
 * PostgreSQL data-access layer.
 *
 * Owns the connection pool and every query. Callers get small, named
 * functions ("save this analysis", "have we seen this member lately?") and
 * never build SQL themselves — all queries here are parameterized, so nothing
 * a Slack member can put in their profile can alter a statement.
 */

import pg from 'pg';
import { config } from './config.js';
import { log, describeError } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  max: config.database.maxConnections,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => log.debug('database_connection_opened'));
pool.on('error', (err) => log.error('database_pool_error', err.message));

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS member_analyses (
        id SERIAL PRIMARY KEY,
        member_id VARCHAR(255),
        member_name VARCHAR(255) NOT NULL,
        member_email VARCHAR(255),
        member_title VARCHAR(255),
        member_timezone VARCHAR(100),
        fit_score INTEGER NOT NULL,
        insights JSONB,
        recommendations JSONB,
        research_data JSONB,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_to_slack BOOLEAN DEFAULT FALSE,
        sent_to_slack_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_member_id ON member_analyses(member_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analyzed_at ON member_analyses(analyzed_at);`);
    log.info('database_schema_ready');
  } catch (error) {
    log.error('database_init_failed', describeError(error));
    throw error;
  } finally {
    client.release();
  }
}

export async function saveMemberAnalysis(memberInfo, analysis, researchData) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO member_analyses (
        member_id, member_name, member_email, member_title, member_timezone,
        fit_score, insights, recommendations, research_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        memberInfo.id || null,
        memberInfo.name,
        memberInfo.email || null,
        memberInfo.title || null,
        memberInfo.timezone || null,
        analysis.fitScore,
        JSON.stringify(analysis.insights),
        JSON.stringify(analysis.recommendations),
        JSON.stringify(researchData),
      ],
    );
    const id = result.rows[0].id;
    log.info('analysis_saved', { id, member: memberInfo.name });
    return id;
  } catch (error) {
    log.error('analysis_save_failed', error.message);
    throw error;
  } finally {
    client.release();
  }
}

export async function markAsSentToSlack(analysisId) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE member_analyses
         SET sent_to_slack = TRUE,
             sent_to_slack_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [analysisId],
    );
  } catch (error) {
    log.error('mark_sent_failed', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Has this member already been analyzed within the given window?
 *
 * `member_joined_channel` fires once per channel, and a workspace can trigger
 * both `team_join` and a channel join in quick succession. Without this guard
 * a single person generates a burst of duplicate reports.
 */
export async function findRecentAnalysis(memberId, withinHours) {
  if (!memberId) return null;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, analyzed_at
         FROM member_analyses
        WHERE member_id = $1
          AND analyzed_at > NOW() - ($2 || ' hours')::interval
        ORDER BY analyzed_at DESC
        LIMIT 1`,
      [memberId, String(withinHours)],
    );
    return result.rows[0] || null;
  } catch (error) {
    // A dedup lookup failure must never block the actual work — degrade to
    // "not seen before" and let the analysis proceed.
    log.warn('dedup_lookup_failed', error.message);
    return null;
  } finally {
    client.release();
  }
}

/** Page through stored analyses, newest first. For the admin API. */
export async function listAnalyses({ limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const client = await pool.connect();
  try {
    const [rows, count] = await Promise.all([
      client.query(
        `SELECT id, member_id, member_name, member_email, member_title,
                fit_score, insights, recommendations, analyzed_at, sent_to_slack
           FROM member_analyses
          ORDER BY analyzed_at DESC
          LIMIT $1 OFFSET $2`,
        [safeLimit, safeOffset],
      ),
      client.query(`SELECT COUNT(*)::int AS total FROM member_analyses`),
    ]);
    return { items: rows.rows, total: count.rows[0].total, limit: safeLimit, offset: safeOffset };
  } finally {
    client.release();
  }
}

/** One analysis by primary key, or null. */
export async function getAnalysis(id) {
  const client = await pool.connect();
  try {
    const result = await client.query(`SELECT * FROM member_analyses WHERE id = $1`, [id]);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/** Aggregate stats for the admin dashboard. */
export async function getStats() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        COUNT(*)::int                                             AS total,
        COUNT(*) FILTER (WHERE sent_to_slack)::int                AS sent,
        COALESCE(ROUND(AVG(fit_score))::int, 0)                   AS avg_fit_score,
        COUNT(*) FILTER (WHERE fit_score >= 80)::int              AS hot,
        COUNT(*) FILTER (WHERE fit_score >= 60 AND fit_score < 80)::int AS warm,
        COUNT(*) FILTER (WHERE fit_score >= 40 AND fit_score < 60)::int AS lukewarm,
        COUNT(*) FILTER (WHERE fit_score < 40)::int               AS cold,
        MAX(analyzed_at)                                          AS last_analyzed_at
      FROM member_analyses
    `);
    const r = result.rows[0];
    return {
      total: r.total,
      sentToSlack: r.sent,
      avgFitScore: r.avg_fit_score,
      distribution: { hot: r.hot, warm: r.warm, lukewarm: r.lukewarm, cold: r.cold },
      lastAnalyzedAt: r.last_analyzed_at,
    };
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await pool.end();
  log.info('database_pool_closed');
}

export default pool;
