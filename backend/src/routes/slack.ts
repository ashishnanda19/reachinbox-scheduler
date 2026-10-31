import { type Request, Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { STATE_TTL_SECONDS, signToken, verifyToken } from '../lib/tokens.js';
import { backendUrl, frontendUrl } from '../lib/urls.js';
import { currentUser, getSessionUserId, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_TIMEOUT_MS = 10_000;

interface SlackAccessResponse {
  ok: boolean;
  error?: string;
  incoming_webhook?: { url: string; channel?: string };
}

const redirectUri = () => backendUrl('/api/slack/callback');
const queryString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export const slackRouter = Router();

// Slack redirects the browser here, so it is public: the signed state proves which user started the flow.
slackRouter.get(
  '/callback',
  asyncHandler(async (req: Request, res) => {
    const dashboard = (result: string) => res.redirect(frontendUrl(`/dashboard?slack=${result}`));
    const code = queryString(req.query.code);
    const state = verifyToken<{ userId?: string }>('slack-connect', queryString(req.query.state) ?? '');
    const userId = state?.userId;

    if (queryString(req.query.error)) return dashboard('denied');
    if (!code || !userId) return dashboard('invalid_state');
    // If the browser also carries a session, it must belong to the user who started the flow.
    const sessionUserId = getSessionUserId(req);
    if (sessionUserId && sessionUserId !== userId) return dashboard('invalid_state');

    let access: SlackAccessResponse;
    try {
      const response = await fetch(SLACK_ACCESS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.SLACK_CLIENT_ID,
          client_secret: config.SLACK_CLIENT_SECRET,
          redirect_uri: redirectUri(),
        }),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      });
      access = (await response.json()) as SlackAccessResponse;
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'slack token exchange failed');
      return dashboard('error');
    }

    const webhook = access.incoming_webhook;
    if (!access.ok || !webhook?.url) {
      logger.warn({ error: access.error }, 'slack oauth did not return an incoming webhook');
      return dashboard('error');
    }

    await pool.query(
      `INSERT INTO slack_connections (user_id, webhook_url, channel)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url, channel = EXCLUDED.channel`,
      [userId, webhook.url, webhook.channel ?? null],
    );
    logger.info({ userId, channel: webhook.channel }, 'slack connected');
    dashboard('connected');
  }),
);

slackRouter.use(requireAuth);

slackRouter.get('/connect', (req, res) => {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    res.status(503).json({ error: 'slack_oauth_not_configured' });
    return;
  }

  const params = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID,
    scope: 'incoming-webhook',
    redirect_uri: redirectUri(),
    state: signToken('slack-connect', { userId: currentUser(req).id }, STATE_TTL_SECONDS),
  });
  res.redirect(`${SLACK_AUTHORIZE_URL}?${params}`);
});

slackRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ channel: string | null }>(
      'SELECT channel FROM slack_connections WHERE user_id = $1',
      [currentUser(req).id],
    );
    res.json({ connected: rows.length > 0, channel: rows[0]?.channel ?? null });
  }),
);

slackRouter.delete(
  '/disconnect',
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM slack_connections WHERE user_id = $1', [currentUser(req).id]);
    res.json({ connected: false, channel: null });
  }),
);
