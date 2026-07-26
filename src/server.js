/**
 * HTTP surface: health check, read-only admin API, and a dev test endpoint.
 *
 * The admin API turns the analyses table into something you can actually
 * inspect (list + stats) instead of a write-only sink. When `ADMIN_API_KEY`
 * is set those routes require an `X-API-Key` header; unset means open, which
 * is fine for local development only.
 */

import express from 'express';
import { config } from './config.js';
import { log } from './logger.js';
import { listAnalyses, getAnalysis, getStats } from './db.js';
import { processMember } from './pipeline.js';

/** Guard `/api/*` with an API key when one is configured. */
function adminAuth(req, res, next) {
  if (!config.admin.apiKey) return next(); // open in dev
  const provided = req.get('X-API-Key');
  if (provided && provided === config.admin.apiKey) return next();
  return res.status(401).json({ error: 'unauthorized', message: 'Valid X-API-Key header required.' });
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createServer(deps = {}) {
  const db = {
    listAnalyses: deps.listAnalyses || listAnalyses,
    getAnalysis: deps.getAnalysis || getAnalysis,
    getStats: deps.getStats || getStats,
  };
  const runPipeline = deps.processMember || processMember;
  const postMessage = deps.postMessage;

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'slack-ai-agent', timestamp: new Date().toISOString() });
  });

  // ---- Read-only admin API ----
  const api = express.Router();
  api.use(adminAuth);

  api.get(
    '/stats',
    asyncRoute(async (req, res) => {
      res.json(await db.getStats());
    }),
  );

  api.get(
    '/analyses',
    asyncRoute(async (req, res) => {
      const limit = Number.parseInt(req.query.limit ?? '20', 10);
      const offset = Number.parseInt(req.query.offset ?? '0', 10);
      res.json(await db.listAnalyses({ limit, offset }));
    }),
  );

  api.get(
    '/analyses/:id',
    asyncRoute(async (req, res) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
      const row = await db.getAnalysis(id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.json(row);
    }),
  );

  app.use('/api', api);

  // ---- Dev-only manual analysis trigger ----
  if (config.isDev) {
    app.post(
      '/test/analyze-member',
      asyncRoute(async (req, res) => {
        const { memberInfo } = req.body || {};
        if (!memberInfo || !memberInfo.name) {
          return res.status(400).json({ error: 'memberInfo (with a name) is required' });
        }
        const result = await runPipeline(memberInfo, { postMessage, force: true });
        res.json({ success: true, ...result, timestamp: new Date().toISOString() });
      }),
    );
    log.info('dev_test_endpoint_enabled', 'POST /test/analyze-member');
  }

  // Final error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error('http_error', err.message);
    res.status(500).json({ error: 'internal_server_error' });
  });

  return app;
}
