import { describe, expect, it } from 'vitest';
import { computeRescheduleTime, effectiveLimit, HOUR_MS, nextWindowStart, windowIndex, windowStart } from './hourWindow.js';

const T = Date.UTC(2026, 9, 30, 18, 15, 1, 500); // 2026-10-30 18:15:01.5 UTC
const H18 = Date.UTC(2026, 9, 30, 18);
const H19 = Date.UTC(2026, 9, 30, 19);

describe('window math', () => {
  it('windowStart floors to the UTC clock hour', () => {
    expect(windowStart(T)).toBe(H18);
    expect(windowStart(H18)).toBe(H18); // boundary belongs to the new window
    expect(windowStart(H19 - 1)).toBe(H18);
  });

  it('nextWindowStart is always the following hour boundary', () => {
    expect(nextWindowStart(T)).toBe(H19);
    expect(nextWindowStart(H18)).toBe(H19); // exactly on a boundary still moves a full hour
    expect(nextWindowStart(H19 - 1)).toBe(H19);
  });

  it('windowIndex is floor(epochMs / 3600000) and changes exactly at the boundary', () => {
    expect(windowIndex(T)).toBe(Math.floor(T / HOUR_MS));
    expect(windowIndex(H19)).toBe(windowIndex(H19 - 1) + 1);
  });

  it('handles the epoch', () => {
    expect(windowStart(0)).toBe(0);
    expect(nextWindowStart(0)).toBe(HOUR_MS);
  });
});

describe('effectiveLimit', () => {
  it('is the smaller of the campaign limit and the configured maximum', () => {
    expect(effectiveLimit(5, 200)).toBe(5);
    expect(effectiveLimit(9999, 200)).toBe(200);
  });
});

describe('computeRescheduleTime', () => {
  const base = { now: T, campaignStartMs: T, limit: 5, delayBetweenMs: 2000 };

  it('puts the first overflow emails at the start of the next window, ordered by rank', () => {
    expect(computeRescheduleTime({ ...base, senderRank: 5 })).toBe(H19); // rank 5 -> window +1, slot 0
    expect(computeRescheduleTime({ ...base, senderRank: 6 })).toBe(H19 + 2000);
    expect(computeRescheduleTime({ ...base, senderRank: 9 })).toBe(H19 + 4 * 2000);
  });

  it('spills later ranks into later windows, `limit` per window', () => {
    expect(computeRescheduleTime({ ...base, senderRank: 10 })).toBe(H19 + HOUR_MS);
    expect(computeRescheduleTime({ ...base, senderRank: 14 })).toBe(H19 + HOUR_MS + 4 * 2000);
  });

  it('never schedules before the next window, even for a low rank', () => {
    expect(computeRescheduleTime({ ...base, senderRank: 2 })).toBe(H19 + 2 * 2000);
  });

  it('keeps the offset inside the hour for huge delays', () => {
    const t = computeRescheduleTime({ ...base, senderRank: 4, delayBetweenMs: 10 * HOUR_MS });
    expect(t).toBe(H19 + HOUR_MS - 1);
    expect(windowStart(t)).toBe(H19);
  });

  it('with zero delay every email of a window lands on the window start', () => {
    expect(computeRescheduleTime({ ...base, senderRank: 7, delayBetweenMs: 0 })).toBe(H19);
  });
});
