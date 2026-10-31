import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { BULL_BOARD_PATH, createBullBoardRouter } from './admin/bullBoard.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { campaignsRouter } from './routes/campaigns.js';
import { emailsRouter } from './routes/emails.js';
import { queueRouter } from './routes/queue.js';
import { searchRouter } from './routes/search.js';
import { sendersRouter } from './routes/senders.js';
import { slackRouter } from './routes/slack.js';
import { statsRouter } from './routes/stats.js';
import { logger } from './utils/logger.js';

async function check(probe: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await probe();
    return 'up';
  } catch {
    return 'down';
  }
}

export function createApp(): Express {
  const app = express();

  // same-site: the app (e.g. :5173) and the API (:4000) are different origins of the same site, and the app embeds
  // attachment thumbnails from the API. The default (same-origin) would block them.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.FRONTEND_URL, credentials: true, methods: ['GET', 'POST', 'DELETE'] }));
  app.use(cookieParser());
  // 5000 recipients is ~150KB, over express's 100kb default. Campaign creation can carry base64 attachments
  // (up to 5 MB of files), so it gets 8 MB; it is parsed after authentication so anonymous requests never buffer that much.
  const json = express.json({ limit: '2mb' });
  app.use((req, res, next) => (req.path.startsWith('/api/campaigns') ? next() : json(req, res, next)));
  app.use(pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
      // Never write session cookies (or OAuth codes in URLs' cookies) to the logs.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    }));

  app.get('/health', async (_req, res) => {
    const [db, redisStatus] = await Promise.all([
      check(() => pool.query('SELECT 1')),
      check(() => redis.ping()),
    ]);
    const healthy = db === 'up' && redisStatus === 'up';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      db,
      redis: redisStatus,
    });
  });

  // Public: OAuth entry/callbacks (the routers guard /me, /connect etc. themselves) and /health above.
  app.use('/api/auth', authRouter);
  app.use('/api/slack', slackRouter);

  // Everything else needs a valid session cookie.
  app.use(BULL_BOARD_PATH, requireAuth, createBullBoardRouter());
  app.use('/api', requireAuth);
  app.use('/api/campaigns', express.json({ limit: '8mb' }), campaignsRouter);
  app.use('/api/senders', sendersRouter);
  app.use('/api/emails', emailsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/queue', queueRouter);

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // body-parser errors carry their own 4xx status (413 payload too large, 400 malformed JSON).
    const status = Number((err as { status?: number }).status);
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: status === 413 ? 'payload_too_large' : 'bad_request' });
      return;
    }
    logger.error({ err }, 'unhandled request error');
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}
