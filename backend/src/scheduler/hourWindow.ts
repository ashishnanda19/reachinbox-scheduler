// Pure clock-hour (UTC) window math for the hourly rate limiter. No I/O, no config.

export const HOUR_MS = 3_600_000;

/** Index of the clock-hour window containing ts: floor(epochMs / 3600000). */
export function windowIndex(ts: number): number {
  return Math.floor(ts / HOUR_MS);
}

export function windowStart(ts: number): number {
  return windowIndex(ts) * HOUR_MS;
}

export function nextWindowStart(ts: number): number {
  return windowStart(ts) + HOUR_MS;
}

export function effectiveLimit(campaignHourlyLimit: number, maxPerSender: number): number {
  return Math.min(campaignHourlyLimit, maxPerSender);
}

export interface RescheduleInput {
  now: number;
  campaignStartMs: number;
  /** Number of earlier (by position) emails of the same campaign and sender: a stable, order-preserving rank. */
  senderRank: number;
  limit: number;
  delayBetweenMs: number;
}

/**
 * When a rate-limited email should run next. Never earlier than the next window; otherwise it goes to the
 * window its rank maps to (`limit` emails per sender per window, campaign order preserved), spaced
 * rank * delayBetweenMs into the hour. Placement is best effort: the Redis limiter is what enforces the
 * limit, so an email that lands in a full window is simply rejected and re-slotted again.
 */
export function computeRescheduleTime({ now, campaignStartMs, senderRank, limit, delayBetweenMs }: RescheduleInput): number {
  const plannedWindow = windowIndex(campaignStartMs) + Math.floor(senderRank / limit);
  const targetWindow = Math.max(windowIndex(now) + 1, plannedWindow);
  const offsetMs = Math.min((senderRank % limit) * delayBetweenMs, HOUR_MS - 1);
  return targetWindow * HOUR_MS + offsetMs;
}
