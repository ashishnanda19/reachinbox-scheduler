import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { signToken, STATE_TTL_SECONDS, verifyToken } from './tokens.js';

describe('signed state / session tokens', () => {
  it('round-trips a payload for the matching purpose', () => {
    const token = signToken('slack-connect', { userId: 'user-1' }, STATE_TTL_SECONDS);

    expect(verifyToken<{ userId: string }>('slack-connect', token)).toMatchObject({ userId: 'user-1' });
  });

  it('rejects a token used for a different purpose (a state can never act as a session)', () => {
    const state = signToken('slack-connect', { userId: 'user-1', sub: 'user-1' }, STATE_TTL_SECONDS);

    expect(verifyToken('session', state)).toBeNull();
    expect(verifyToken('google-login', state)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signToken('slack-connect', { userId: 'victim' }, STATE_TTL_SECONDS).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ userId: 'attacker', purpose: 'slack-connect' })).toString('base64url');

    expect(verifyToken('slack-connect', `${header}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ userId: 'user-1', purpose: 'slack-connect' }, 'some-other-secret-of-sufficient-length!!');

    expect(verifyToken('slack-connect', forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = signToken('google-login', { nonce: 'n' }, -10);

    expect(verifyToken('google-login', expired)).toBeNull();
  });

  it('rejects unsigned (alg=none) tokens and garbage', () => {
    const unsigned = jwt.sign({ userId: 'user-1', purpose: 'slack-connect' }, '', { algorithm: 'none' });

    expect(verifyToken('slack-connect', unsigned)).toBeNull();
    expect(verifyToken('slack-connect', 'not-a-jwt')).toBeNull();
    expect(verifyToken('slack-connect', '')).toBeNull();
  });

  it('uses the configured secret and expires in the requested time', () => {
    const token = signToken('session', { sub: 'u' }, 60);
    const payload = jwt.verify(token, config.JWT_SECRET) as { exp: number; iat: number };

    expect(payload.exp - payload.iat).toBe(60);
  });
});
