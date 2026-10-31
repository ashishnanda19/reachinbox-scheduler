import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Integration test: the real Express app on an ephemeral port, real Postgres/Redis from docker-compose.
// Only Google's and Slack's servers are faked (by intercepting fetch); requests to the app go through.
vi.mock('../services/senders.js', () => ({ ensureSenders: vi.fn(async () => []) }));

const FRONTEND = 'https://app.example.test';
const BACKEND = 'https://backend.example.test';
const realFetch = globalThis.fetch;

let server: Server;
let base: string;
let tokens: typeof import('../lib/tokens.js');
let pool: typeof import('../db/pool.js').pool;
let ensureSenders: ReturnType<typeof vi.fn>;
let closeResources: () => Promise<void>;

let googleToken: () => Response;
let googleProfile: () => Response;
let slackAccess: () => Response;

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function call(path: string, init: { method?: string; cookies?: Record<string, string> } = {}) {
  const cookie = Object.entries(init.cookies ?? {}).map(([k, v]) => `${k}=${v}`).join('; ');
  return realFetch(`${base}${path}`, { method: init.method, redirect: 'manual', headers: cookie ? { cookie } : {} });
}

const cookieFrom = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const cookieValue = (setCookie: string): string => setCookie.split(';')[0]!.split('=').slice(1).join('=');
const location = (res: Response) => new URL(res.headers.get('location')!);

/** Walks the real /google -> callback flow with the faked Google servers and returns the session cookie. */
async function loginAs(googleId: string, profile: Record<string, unknown> = {}): Promise<{ session: string; res: Response }> {
  googleProfile = () => json({ sub: googleId, email: `${googleId}@example.com`, name: 'Test User', picture: 'https://img.test/a.png', ...profile });
  const start = await call('/api/auth/google');
  const state = location(start).searchParams.get('state')!;
  const res = await call(`/api/auth/google/callback?code=abc&state=${state}`, { cookies: { oauth_state: cookieValue(cookieFrom(start, 'oauth_state')!) } });
  return { session: cookieValue(cookieFrom(res, 'session') ?? 'session='), res };
}

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-secret');
  vi.stubEnv('SLACK_CLIENT_ID', 'test-slack-client');
  vi.stubEnv('SLACK_CLIENT_SECRET', 'test-slack-secret');
  vi.stubEnv('BACKEND_URL', BACKEND);
  vi.stubEnv('FRONTEND_URL', FRONTEND);

  const { createApp } = await import('../app.js');
  tokens = await import('../lib/tokens.js');
  pool = (await import('../db/pool.js')).pool;
  ensureSenders = (await import('../services/senders.js')).ensureSenders as unknown as ReturnType<typeof vi.fn>;
  const { redis } = await import('../lib/redis.js');
  const { emailQueue } = await import('../scheduler/queue.js');
  closeResources = async () => {
    await emailQueue.close();
    await redis.quit();
    await pool.end();
  };

  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://oauth2.googleapis.com/token') return googleToken();
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return googleProfile();
    if (url === 'https://slack.com/api/oauth.v2.access') return slackAccess();
    return realFetch(input, init);
  });
});

afterEach(() => {
  googleToken = () => json({ access_token: 'google-access-token' });
  slackAccess = () => json({ ok: true, incoming_webhook: { url: 'https://hooks.slack.test/services/T/B/x', channel: '#alerts' } });
  ensureSenders.mockClear();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE google_id LIKE 'vitest-auth-%'");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeResources();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('protected routes', () => {
  it.each([
    '/api/auth/me',
    '/api/emails/scheduled',
    '/api/emails/sent',
    '/api/stats',
    '/api/search?q=x',
    '/api/queue/counts',
    '/api/slack/status',
    '/api/slack/connect',
    '/admin/queues',
  ])('%s answers 401 without a session', async (path) => {
    expect((await call(path)).status).toBe(401);
  });

  it('POST /api/campaigns and /api/search/reindex answer 401 without a session', async () => {
    expect((await call('/api/campaigns', { method: 'POST' })).status).toBe(401);
    expect((await call('/api/search/reindex', { method: 'POST' })).status).toBe(401);
  });

  it('leaves /health public', async () => {
    expect((await call('/health')).status).toBe(200);
  });

  it('rejects forged, expired and wrong-purpose session cookies', async () => {
    const { session } = await loginAs('vitest-auth-valid');
    const userId = (jwt.decode(session) as { sub: string }).sub;

    const forged = jwt.sign({ sub: userId, purpose: 'session' }, 'another-secret-another-secret-123456');
    const expired = tokens.signToken('session', { sub: userId }, -10);
    const slackState = tokens.signToken('slack-connect', { userId, sub: userId }, 600);
    const deletedUser = tokens.signToken('session', { sub: '00000000-0000-4000-8000-000000000000' }, 600);

    expect((await call('/api/auth/me', { cookies: { session } })).status).toBe(200);
    for (const bad of [forged, expired, slackState, deletedUser, 'garbage']) {
      expect((await call('/api/auth/me', { cookies: { session: bad } })).status, bad).toBe(401);
    }
  });
});

describe('Google login', () => {
  it('redirects to Google with the required parameters and a signed state cookie', async () => {
    const res = await call('/api/auth/google');
    const url = location(res);
    const stateCookie = cookieFrom(res, 'oauth_state')!;

    expect(res.status).toBe(302);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('test-google-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BACKEND}/api/auth/google/callback`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    const state = url.searchParams.get('state')!;
    expect(tokens.verifyToken('google-login', state)).not.toBeNull();
    expect(cookieValue(stateCookie)).toBe(state);
    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).toMatch(/Max-Age=600/i);
  });

  it('logs in, upserts the user, ensures senders, sets an httpOnly lax 7-day cookie and goes to the dashboard', async () => {
    const { session, res } = await loginAs('vitest-auth-login');
    const setCookie = cookieFrom(res, 'session')!;
    const userId = (jwt.decode(session) as { sub: string; exp: number; iat: number });

    expect(res.status).toBe(302);
    expect(location(res).href).toBe(`${FRONTEND}/dashboard`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=604800/i);
    expect(userId.exp - userId.iat).toBe(7 * 24 * 60 * 60);
    expect(ensureSenders).toHaveBeenCalledWith(userId.sub);

    const me = await call('/api/auth/me', { cookies: { session } });
    expect(await me.json()).toEqual({ name: 'Test User', email: 'vitest-auth-login@example.com', avatar_url: 'https://img.test/a.png' });
  });

  it('upserts by google_id: logging in again updates the profile instead of duplicating the user', async () => {
    await loginAs('vitest-auth-repeat', { name: 'Old Name' });
    await loginAs('vitest-auth-repeat', { name: 'New Name' });

    const { rows } = await pool.query("SELECT name FROM users WHERE google_id = 'vitest-auth-repeat'");
    expect(rows).toEqual([{ name: 'New Name' }]);
  });

  it('still logs in when creating senders fails', async () => {
    ensureSenders.mockRejectedValueOnce(new Error('ethereal down'));

    const { res } = await loginAs('vitest-auth-nosenders');

    expect(location(res).href).toBe(`${FRONTEND}/dashboard`);
    expect(cookieFrom(res, 'session')).toBeDefined();
  });

  it.each([
    ['no state cookie', () => ({ query: 'code=abc&state=anything', cookies: {} })],
    ['no code', () => ({ query: 'state=anything', cookies: { oauth_state: 'anything' } })],
    ['mismatched state', () => ({ query: 'code=abc&state=one', cookies: { oauth_state: 'two' } })],
    [
      'matching but unsigned state',
      () => ({ query: 'code=abc&state=forged', cookies: { oauth_state: 'forged' } }),
    ],
    [
      'a signed state of another purpose',
      () => {
        const state = tokens.signToken('slack-connect', { userId: 'x' }, 600);
        return { query: `code=abc&state=${state}`, cookies: { oauth_state: state } };
      },
    ],
  ])('rejects the callback with %s', async (_name, build) => {
    const { query, cookies } = build();
    const res = await call(`/api/auth/google/callback?${query}`, { cookies });

    expect(location(res).href).toBe(`${FRONTEND}/login?error=invalid_state`);
    expect(cookieFrom(res, 'session')).toBeUndefined();
  });

  it('reports a denied consent screen and a failed code exchange without creating a session', async () => {
    const start = await call('/api/auth/google');
    const state = location(start).searchParams.get('state')!;
    const cookies = { oauth_state: cookieValue(cookieFrom(start, 'oauth_state')!) };

    const denied = await call(`/api/auth/google/callback?error=access_denied&state=${state}`, { cookies });
    expect(location(denied).href).toBe(`${FRONTEND}/login?error=google_denied`);

    googleToken = () => json({ error: 'invalid_grant' }, 400);
    const failed = await call(`/api/auth/google/callback?code=bad&state=${state}`, { cookies });
    expect(location(failed).href).toBe(`${FRONTEND}/login?error=google_exchange_failed`);
    expect(cookieFrom(failed, 'session')).toBeUndefined();
  });

  it('logout clears the session cookie', async () => {
    const res = await call('/api/auth/logout', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(cookieFrom(res, 'session')).toMatch(/session=;/);
    expect(cookieFrom(res, 'session')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('Slack OAuth', () => {
  it('redirects to Slack with the incoming-webhook scope and a signed state carrying the user id', async () => {
    const { session } = await loginAs('vitest-auth-slack-connect');
    const userId = (jwt.decode(session) as { sub: string }).sub;

    const res = await call('/api/slack/connect', { cookies: { session } });
    const url = location(res);

    expect(res.status).toBe(302);
    expect(`${url.origin}${url.pathname}`).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-slack-client');
    expect(url.searchParams.get('scope')).toBe('incoming-webhook');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BACKEND}/api/slack/callback`);
    expect(tokens.verifyToken<{ userId: string }>('slack-connect', url.searchParams.get('state')!)?.userId).toBe(userId);
  });

  it('stores the webhook on callback, reports status, and disconnects', async () => {
    const { session } = await loginAs('vitest-auth-slack-flow');
    const userId = (jwt.decode(session) as { sub: string }).sub;
    const state = tokens.signToken('slack-connect', { userId }, 600);

    expect(await (await call('/api/slack/status', { cookies: { session } })).json()).toEqual({ connected: false, channel: null });

    // Slack redirects the browser here; the session cookie is present but not required.
    const res = await call(`/api/slack/callback?code=slack-code&state=${state}`, { cookies: { session } });
    expect(location(res).href).toBe(`${FRONTEND}/dashboard?slack=connected`);
    expect(await (await call('/api/slack/status', { cookies: { session } })).json()).toEqual({ connected: true, channel: '#alerts' });
    expect((await pool.query('SELECT webhook_url FROM slack_connections WHERE user_id = $1', [userId])).rows[0].webhook_url).toBe(
      'https://hooks.slack.test/services/T/B/x',
    );

    // Reconnecting replaces the row (one connection per user).
    slackAccess = () => json({ ok: true, incoming_webhook: { url: 'https://hooks.slack.test/services/T/B/y', channel: '#ops' } });
    await call(`/api/slack/callback?code=again&state=${state}`);
    expect(await (await call('/api/slack/status', { cookies: { session } })).json()).toEqual({ connected: true, channel: '#ops' });
    expect((await pool.query('SELECT 1 FROM slack_connections WHERE user_id = $1', [userId])).rowCount).toBe(1);

    const gone = await call('/api/slack/disconnect', { method: 'DELETE', cookies: { session } });
    expect(await gone.json()).toEqual({ connected: false, channel: null });
    expect(await (await call('/api/slack/status', { cookies: { session } })).json()).toEqual({ connected: false, channel: null });
  });

  it('rejects a bad, missing or other-purpose state, and a session of a different user', async () => {
    const { session: sessionA } = await loginAs('vitest-auth-slack-a');
    const { session: sessionB } = await loginAs('vitest-auth-slack-b');
    const userB = (jwt.decode(sessionB) as { sub: string }).sub;
    const invalid = `${FRONTEND}/dashboard?slack=invalid_state`;

    for (const state of ['forged', '', tokens.signToken('google-login', { userId: userB }, 600)]) {
      expect(location(await call(`/api/slack/callback?code=c&state=${state}`)).href).toBe(invalid);
    }
    // State was issued for user B but the browser is logged in as user A.
    const stateB = tokens.signToken('slack-connect', { userId: userB }, 600);
    expect(location(await call(`/api/slack/callback?code=c&state=${stateB}`, { cookies: { session: sessionA } })).href).toBe(invalid);
    expect((await pool.query('SELECT 1 FROM slack_connections WHERE user_id = $1', [userB])).rowCount).toBe(0);
  });

  it('reports Slack failures without storing anything', async () => {
    const { session } = await loginAs('vitest-auth-slack-fail');
    const userId = (jwt.decode(session) as { sub: string }).sub;
    const state = tokens.signToken('slack-connect', { userId }, 600);

    slackAccess = () => json({ ok: false, error: 'invalid_code' });
    expect(location(await call(`/api/slack/callback?code=bad&state=${state}`)).href).toBe(`${FRONTEND}/dashboard?slack=error`);

    slackAccess = () => json({ ok: true }); // no incoming_webhook granted
    expect(location(await call(`/api/slack/callback?code=bad&state=${state}`)).href).toBe(`${FRONTEND}/dashboard?slack=error`);

    expect(location(await call(`/api/slack/callback?error=access_denied&state=${state}`)).href).toBe(`${FRONTEND}/dashboard?slack=denied`);
    expect((await pool.query('SELECT 1 FROM slack_connections WHERE user_id = $1', [userId])).rowCount).toBe(0);
  });
});

describe('authenticated API', () => {
  it('serves the queue counts, search and Bull Board to a logged-in user', async () => {
    const { session } = await loginAs('vitest-auth-api');

    const counts = await call('/api/queue/counts', { cookies: { session } });
    expect(Object.keys((await counts.json()) as object).sort()).toEqual(['active', 'completed', 'delayed', 'failed', 'waiting']);

    const search = await call('/api/search?q=anything', { cookies: { session } });
    expect(search.status).toBe(200);
    expect(['elasticsearch', 'sql']).toContain(((await search.json()) as { source: string }).source);

    const board = await call('/admin/queues/', { cookies: { session } });
    expect(board.status).toBe(200);
    expect(await board.text()).toContain('Bull Dashboard');

    expect((await call('/api/search?status=bogus', { cookies: { session } })).status).toBe(400);
  });
});
