import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { redis } from '../lib/redis.js';
import { HOUR_MS } from './hourWindow.js';
import { acquireSendSlot, claimRateLimitNotice, rateLimitKey, refundSendSlot } from './rateLimiter.js';

// Integration test: needs the Redis from docker-compose.
const senders: string[] = [];
const newSender = (): string => {
  const id = `test-${randomUUID()}`;
  senders.push(id);
  return id;
};

afterAll(async () => {
  const keys = await redis.keys('ratelimit:test-*');
  const notices = await redis.keys('slack-notified:test-*');
  if (keys.length + notices.length > 0) await redis.del(...keys, ...notices);
  await redis.quit();
});

describe('hourly rate limiter', () => {
  it('allows exactly `limit` of 50 parallel calls', async () => {
    const sender = newSender();
    const now = Date.now();

    const results = await Promise.all(Array.from({ length: 50 }, () => acquireSendSlot(sender, 10, now)));

    expect(results.filter((slot) => slot.allowed)).toHaveLength(10);
    expect(results.filter((slot) => !slot.allowed)).toHaveLength(40);
    // Rejected attempts are not counted: the counter ends exactly at the limit.
    expect(await redis.get(rateLimitKey(sender, results[0]!.window))).toBe('10');
  });

  it('sets an expiry on the counter', async () => {
    const sender = newSender();
    const slot = await acquireSendSlot(sender, 3);
    const ttl = await redis.ttl(rateLimitKey(sender, slot.window));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(HOUR_MS / 1000 + 300);
  });

  it('counts per sender, independently', async () => {
    const [a, b] = [newSender(), newSender()];
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) await acquireSendSlot(a, 3, now);

    expect((await acquireSendSlot(a, 3, now)).allowed).toBe(false);
    expect((await acquireSendSlot(b, 3, now)).allowed).toBe(true);
  });

  it('gives a fresh allowance in the next window', async () => {
    const sender = newSender();
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) await acquireSendSlot(sender, 5, now);
    expect((await acquireSendSlot(sender, 5, now)).allowed).toBe(false);

    const next = await acquireSendSlot(sender, 5, now + HOUR_MS);
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it('refund frees a slot and never drives the counter below zero', async () => {
    const sender = newSender();
    const now = Date.now();
    const slots = await Promise.all([1, 2].map(() => acquireSendSlot(sender, 2, now)));
    expect((await acquireSendSlot(sender, 2, now)).allowed).toBe(false);

    await refundSendSlot(slots[0]!);
    expect((await acquireSendSlot(sender, 2, now)).allowed).toBe(true);

    const key = rateLimitKey(sender, slots[0]!.window);
    await refundSendSlot(slots[0]!);
    await refundSendSlot(slots[0]!);
    await refundSendSlot(slots[0]!);
    expect(Number(await redis.get(key))).toBe(0);
    await refundSendSlot(slots[0]!);
    expect(Number(await redis.get(key))).toBe(0);
  });
});

describe('rate limit notice dedupe', () => {
  it('lets only one of many parallel callers notify per sender per window', async () => {
    const sender = newSender();
    const wins = await Promise.all(Array.from({ length: 20 }, () => claimRateLimitNotice(sender, 123)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it('notifies again in a new window and for another sender', async () => {
    const [a, b] = [newSender(), newSender()];
    expect(await claimRateLimitNotice(a, 1)).toBe(true);
    expect(await claimRateLimitNotice(a, 1)).toBe(false);
    expect(await claimRateLimitNotice(a, 2)).toBe(true);
    expect(await claimRateLimitNotice(b, 1)).toBe(true);
  });
});
