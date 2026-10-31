import type { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';
import { HOUR_MS, windowIndex } from './hourWindow.js';

// Counters outlive their window by a few minutes so a slow worker never sees a fresh key mid-window.
const COUNTER_TTL_SECONDS = HOUR_MS / 1000 + 300;
const NOTICE_TTL_SECONDS = 3900;

// One atomic script: increment, set expiry on first use, and undo the increment when over the limit so
// rejected attempts are never counted. Running it as a single Lua call is what makes the limit safe
// across any number of workers and instances.
const ACQUIRE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return {0, current - 1}
end
return {1, current}
`;

// Give a slot back without ever driving the counter below zero.
const REFUND_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

type LimiterRedis = Redis & {
  rateLimitAcquire(key: string, limit: number, ttlSeconds: number): Promise<[number, number]>;
  rateLimitRefund(key: string): Promise<number>;
};

redis.defineCommand('rateLimitAcquire', { numberOfKeys: 1, lua: ACQUIRE_LUA });
redis.defineCommand('rateLimitRefund', { numberOfKeys: 1, lua: REFUND_LUA });
const limiter = redis as LimiterRedis;

export interface SendSlot {
  senderId: string;
  window: number;
  allowed: boolean;
  /** Emails counted in this window after the call (rejected attempts are not included). */
  count: number;
}

export function rateLimitKey(senderId: string, window: number): string {
  return `ratelimit:${senderId}:${window}`;
}

/** Try to take one of the sender's `limit` slots in the current hour window. */
export async function acquireSendSlot(senderId: string, limit: number, now: number = Date.now()): Promise<SendSlot> {
  const window = windowIndex(now);
  const [allowed, count] = await limiter.rateLimitAcquire(rateLimitKey(senderId, window), limit, COUNTER_TTL_SECONDS);
  return { senderId, window, allowed: allowed === 1, count };
}

/** Return a slot that was taken but never used to hit the provider (e.g. the min-delay gate deferred the send). */
export async function refundSendSlot(slot: SendSlot): Promise<void> {
  await limiter.rateLimitRefund(rateLimitKey(slot.senderId, slot.window));
}

/** True only for the first rejection of a sender in a window: dedupes the Slack alert. */
export async function claimRateLimitNotice(senderId: string, window: number): Promise<boolean> {
  const result = await redis.set(`slack-notified:${senderId}:${window}`, '1', 'EX', NOTICE_TTL_SECONDS, 'NX');
  return result === 'OK';
}
