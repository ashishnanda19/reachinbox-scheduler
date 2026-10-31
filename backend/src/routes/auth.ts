import { randomBytes } from 'node:crypto';
import { type CookieOptions, type Request, Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { STATE_TTL_SECONDS, signToken, verifyToken } from '../lib/tokens.js';
import { backendUrl, frontendUrl } from '../lib/urls.js';
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie, type AuthUser } from '../middleware/auth.js';
import { ensureSenders } from '../services/senders.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logger } from '../utils/logger.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_TIMEOUT_MS = 10_000;

const STATE_COOKIE = 'oauth_state';
const stateCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.NODE_ENV === 'production',
  path: '/api/auth',
};

interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

const redirectUri = () => backendUrl('/api/auth/google/callback');
const queryString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (!tokenResponse.ok) throw new Error(`google token exchange failed: HTTP ${tokenResponse.status}`);
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!accessToken) throw new Error('google token response had no access_token');

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (!profileResponse.ok) throw new Error(`google userinfo failed: HTTP ${profileResponse.status}`);
  return (await profileResponse.json()) as GoogleProfile;
}

export const authRouter = Router();

authRouter.get('/google', (_req, res) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    res.status(503).json({ error: 'google_oauth_not_configured' });
    return;
  }

  // Random, signed state kept in a short-lived httpOnly cookie and echoed back by Google (CSRF protection).
  const state = signToken('google-login', { nonce: randomBytes(16).toString('hex') }, STATE_TTL_SECONDS);
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions, maxAge: STATE_TTL_SECONDS * 1000 });

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

authRouter.get(
  '/google/callback',
  asyncHandler(async (req: Request, res) => {
    const fail = (reason: string) => res.redirect(frontendUrl(`/login?error=${reason}`));
    const code = queryString(req.query.code);
    const state = queryString(req.query.state);
    const cookieState: unknown = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, stateCookieOptions);

    if (queryString(req.query.error)) return fail('google_denied');
    if (!code || !state || state !== cookieState || !verifyToken('google-login', state)) return fail('invalid_state');

    let profile: GoogleProfile;
    try {
      profile = await fetchGoogleProfile(code);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'google login failed');
      return fail('google_exchange_failed');
    }
    if (!profile.sub || !profile.email) return fail('google_profile_incomplete');

    const { rows } = await pool.query<AuthUser>(
      `INSERT INTO users (google_id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
         SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, email, name, avatar_url`,
      [profile.sub, profile.email, profile.name ?? profile.email, profile.picture ?? null],
    );
    const user = rows[0]!;

    try {
      await ensureSenders(user.id);
    } catch (err) {
      // Ethereal being down must not block login; createCampaign calls ensureSenders again.
      logger.warn({ err: (err as Error).message, userId: user.id }, 'ensureSenders failed during login (ignored)');
    }

    setSessionCookie(res, user.id);
    logger.info({ userId: user.id, email: user.email }, 'user logged in');
    res.redirect(frontendUrl('/dashboard'));
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  const { name, email, avatar_url } = currentUser(req);
  res.json({ name, email, avatar_url });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
