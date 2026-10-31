import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { SESSION_TTL_SECONDS, signToken, verifyToken } from '../lib/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'session';

const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.NODE_ENV === 'production',
  path: '/',
};

export function setSessionCookie(res: Response, userId: string): void {
  res.cookie(SESSION_COOKIE, signToken('session', { sub: userId }, SESSION_TTL_SECONDS), {
    ...sessionCookieOptions,
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
}

/** User id from a valid session cookie, or null. Does not touch the database. */
export function getSessionUserId(req: Request): string | null {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') return null;
  const payload = verifyToken<{ sub?: string }>('session', token);
  return typeof payload?.sub === 'string' ? payload.sub : null;
}

/** Verifies the JWT session cookie and loads the user. Responds 401 otherwise. */
export const requireAuth: RequestHandler = asyncHandler(async (req, res, next) => {
  const userId = getSessionUserId(req);
  const user = userId
    ? (await pool.query<AuthUser>('SELECT id, email, name, avatar_url FROM users WHERE id = $1', [userId])).rows[0]
    : undefined;

  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.user = user;
  next();
});

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new Error('currentUser called on an unauthenticated request');
  return req.user;
}
