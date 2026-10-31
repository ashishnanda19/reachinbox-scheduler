import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { formatRateLimitMessage, hasSlackConnection, notifyRateLimit, type RateLimitNotice } from './slack.js';

// Integration test: needs the Postgres from docker-compose. fetch is mocked, so nothing reaches Slack.
const WEBHOOK = 'https://hooks.slack.test/services/T000/B000/xxxx';
let userId: string;
let userWithoutSlackId: string;

const notice = (overrides: Partial<RateLimitNotice> = {}): RateLimitNotice => ({
  userId,
  senderEmail: 'sender@ethereal.email',
  limit: 5,
  nextWindowAt: new Date('2026-10-30T19:00:00.000Z'),
  ...overrides,
});

const connectionCount = async (id = userId) =>
  (await pool.query('SELECT 1 FROM slack_connections WHERE user_id = $1', [id])).rowCount;

beforeAll(async () => {
  const insert = async (googleId: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (google_id, email, name) VALUES ($1, 'slack-test@example.com', 'Slack Test') RETURNING id`,
        [googleId],
      )
    ).rows[0]!.id;
  userId = await insert('vitest-slack-connected');
  userWithoutSlackId = await insert('vitest-slack-none');
});

beforeEach(async () => {
  await pool.query('DELETE FROM slack_connections WHERE user_id = $1', [userWithoutSlackId]);
  await pool.query(
    `INSERT INTO slack_connections (user_id, webhook_url, channel) VALUES ($1, $2, '#alerts')
     ON CONFLICT (user_id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url`,
    [userId, WEBHOOK],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE google_id LIKE 'vitest-slack-%'");
  await pool.end();
});

describe('notifyRateLimit without a Slack connection', () => {
  it('returns silently, does not throw and does not call Slack', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(notifyRateLimit(notice({ userId: userWithoutSlackId }))).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts notifying as soon as the user connects, with no restart', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await notifyRateLimit(notice({ userId: userWithoutSlackId }));
    expect(fetchSpy).not.toHaveBeenCalled();

    await pool.query('INSERT INTO slack_connections (user_id, webhook_url, channel) VALUES ($1, $2, $3)', [
      userWithoutSlackId,
      WEBHOOK,
      '#late',
    ]);
    await notifyRateLimit(notice({ userId: userWithoutSlackId }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hasSlackConnection', () => {
  it('reflects whether the user is connected right now', async () => {
    expect(await hasSlackConnection(userId)).toBe(true);
    expect(await hasSlackConnection(userWithoutSlackId)).toBe(false);
    await pool.query('DELETE FROM slack_connections WHERE user_id = $1', [userId]);
    expect(await hasSlackConnection(userId)).toBe(false);
  });
});

describe('notifyRateLimit with a Slack connection', () => {
  it('posts a JSON message with sender, limit, delayed count and the next window in ISO and IST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    await notifyRateLimit(notice({ delayedCount: 7 }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const { text } = JSON.parse(init?.body as string) as { text: string };
    expect(text).toContain('sender@ethereal.email');
    expect(text).toContain('5 emails per hour');
    expect(text).toContain('Emails delayed so far:* 7');
    expect(text).toContain('2026-10-30T19:00:00.000Z');
    expect(text).toMatch(/31 Oct 2026, 12:30 am IST/);
  });

  it('omits the delayed count when it is not known', () => {
    expect(formatRateLimitMessage(notice())).not.toContain('delayed so far');
  });

  it.each([404, 410])('removes the connection when Slack answers %i (revoked webhook)', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no_service', { status }));

    await expect(notifyRateLimit(notice())).resolves.toBeUndefined();

    expect(await connectionCount()).toBe(0);
  });

  it('keeps the connection and does not throw on other Slack errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(notifyRateLimit(notice())).resolves.toBeUndefined();

    expect(await connectionCount()).toBe(1);
  });

  it('does not throw when the network call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(notifyRateLimit(notice())).resolves.toBeUndefined();

    expect(await connectionCount()).toBe(1);
  });

  it('gives up after 5 seconds when Slack hangs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const started = Date.now();
    await expect(notifyRateLimit(notice())).resolves.toBeUndefined();

    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(7000);
    expect(await connectionCount()).toBe(1);
  }, 10_000);
});
