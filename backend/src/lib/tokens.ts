import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '../config.js';

// Every token carries a purpose so one kind can never be replayed as another
// (e.g. a Slack OAuth state must not be accepted as a login session).
export type TokenPurpose = 'session' | 'google-login' | 'slack-connect';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const STATE_TTL_SECONDS = 10 * 60;

export function signToken(purpose: TokenPurpose, payload: object, expiresInSeconds: number): string {
  return jwt.sign({ ...payload, purpose }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: expiresInSeconds });
}

/** Returns the payload, or null if the token is malformed, tampered with, expired or of another purpose. */
export function verifyToken<T extends object>(purpose: TokenPurpose, token: string): (T & JwtPayload) | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as T & JwtPayload & { purpose?: string };
    return payload.purpose === purpose ? payload : null;
  } catch {
    return null;
  }
}
