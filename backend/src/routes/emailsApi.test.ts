import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Integration test: real Express app on an ephemeral port, Postgres/Redis from docker-compose, SQL search.
// Only Ethereal account creation is faked, so no real accounts are made.
vi.mock('../services/senders.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/senders.js')>();
  const { pool } = await import('../db/pool.js');
  const insertSender = async (userId: string, email: string) =>
    (
      await pool.query(
        `INSERT INTO senders (user_id, email, smtp_host, smtp_port, smtp_user, smtp_pass) VALUES ($1, $2, 'localhost', 25, 'u', 'p') RETURNING *`,
        [userId, email],
      )
    ).rows[0];
  return {
    ...original,
    ensureSenders: vi.fn(async (userId: string) => {
      const existing = (await pool.query('SELECT * FROM senders WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;
      return existing.length > 0 ? existing : [await insertSender(userId, `auto-${userId.slice(0, 6)}@ethereal.test`)];
    }),
    createSender: vi.fn(async (userId: string) => insertSender(userId, `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@ethereal.test`)),
  };
});

const FRONTEND = 'https://app.example.test';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

let server: Server;
let base: string;
let pool: typeof import('../db/pool.js').pool;
let emailQueue: typeof import('../scheduler/queue.js').emailQueue;
let closeResources: () => Promise<void>;
let cookieA: string;
let cookieB: string;
let userA: string;
let userB: string;

const call = (path: string, init: { method?: string; cookie?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? (init.body !== undefined || init.raw !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(init.cookie ? { cookie: `session=${init.cookie}` } : {}),
      ...(init.body !== undefined || init.raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });

const campaign = (overrides: Record<string, unknown> = {}) => ({
  subject: 'Hello',
  body: '<p>Hi <strong>there</strong></p>',
  recipients: ['one@example.com', 'two@example.com', 'three@example.com'],
  startTime: FUTURE,
  delayBetweenMs: 1000,
  hourlyLimit: 10,
  ...overrides,
});

const file = (name: string, bytes: number, contentType = 'application/pdf') => ({
  filename: name,
  contentType,
  dataBase64: Buffer.alloc(bytes, 1).toString('base64'),
});

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv('FRONTEND_URL', FRONTEND);
  vi.stubEnv('ELASTICSEARCH_URL', ''); // deterministic SQL search

  const { createApp } = await import('../app.js');
  const tokens = await import('../lib/tokens.js');
  pool = (await import('../db/pool.js')).pool;
  emailQueue = (await import('../scheduler/queue.js')).emailQueue;
  const { redis } = await import('../lib/redis.js');
  closeResources = async () => {
    await emailQueue.close();
    await redis.quit();
    await pool.end();
  };

  const makeUser = async (googleId: string, name: string) => {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO users (google_id, email, name) VALUES ($1, $2, $3) RETURNING id',
      [googleId, `${googleId}@example.com`, name],
    );
    return { id: rows[0]!.id, cookie: tokens.signToken('session', { sub: rows[0]!.id }, 600) };
  };
  const a = await makeUser('vitest-api-a', 'Alice Admin');
  const b = await makeUser('vitest-api-b', 'Bob Other');
  [userA, cookieA, userB, cookieB] = [a.id, a.cookie, b.id, b.cookie];

  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = (await pool.query<{ id: string }>('SELECT id FROM emails WHERE user_id = ANY($1)', [[userA, userB]])).rows;
  await Promise.all(ids.map(({ id }) => emailQueue.remove(id).catch(() => undefined)));
  await pool.query("DELETE FROM users WHERE google_id LIKE 'vitest-api-%'");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeResources();
  vi.unstubAllEnvs();
});

describe('POST /api/campaigns validation', () => {
  const rejects = async (body: unknown, expected: RegExp) => {
    const res = await call('/api/campaigns', { cookie: cookieA, body });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(expected);
  };

  it('rejects more than 3 attachments', async () => {
    await rejects(campaign({ attachments: [file('a', 10), file('b', 10), file('c', 10), file('d', 10)] }), /at most 3 attachments/);
  });

  it('rejects a file over 2 MB and names it', async () => {
    await rejects(campaign({ attachments: [file('big.pdf', 2 * 1024 * 1024 + 10)] }), /"big\.pdf" is larger than 2 MB/);
  });

  it('accepts a file of exactly 2 MB', async () => {
    const res = await call('/api/campaigns', { cookie: cookieA, body: campaign({ recipients: ['edge@example.com'], attachments: [file('edge.pdf', 2 * 1024 * 1024)] }) });
    expect(res.status).toBe(201);
  });

  it('rejects more than 5 MB in total', async () => {
    const eighteen = 1.9 * 1024 * 1024;
    await rejects(campaign({ attachments: [file('a', eighteen), file('b', eighteen), file('c', eighteen)] }), /total more than 5 MB/);
  });

  it('rejects invalid base64, an empty body and a foreign sender', async () => {
    await rejects(campaign({ attachments: [{ filename: 'x', contentType: 'text/plain', dataBase64: 'not base64!!' }] }), /not valid base64/);
    await rejects(campaign({ body: '<p> </p>' }), /body must not be empty/);

    const foreign = await call('/api/senders', { cookie: cookieB, method: 'POST' });
    const { id } = (await foreign.json()) as { id: string };
    const res = await call('/api/campaigns', { cookie: cookieA, body: campaign({ senderId: id }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_sender');
  });

  it('answers malformed JSON with 400', async () => {
    expect((await call('/api/campaigns', { cookie: cookieA, raw: '{not json' })).status).toBe(400);
  });

  it('accepts a campaign body bigger than the 2 MB default (route limit is 8 MB) but not on other routes', async () => {
    const padded = JSON.stringify(campaign({ recipients: ['big-body@example.com'], attachments: [file('a.pdf', 2 * 1024 * 1024), file('b.pdf', 2 * 1024 * 1024)] }));
    expect(padded.length).toBeGreaterThan(2 * 1024 * 1024);
    expect((await call('/api/campaigns', { cookie: cookieA, raw: padded })).status).toBe(201);

    const huge = JSON.stringify({ filler: 'x'.repeat(3 * 1024 * 1024) });
    expect((await call('/api/search/reindex', { cookie: cookieA, raw: huge })).status).toBe(413);
  });
});

describe('campaign with sender choice and attachment', () => {
  let senderId: string;
  let emailId: string;

  beforeAll(async () => {
    const sender = await call('/api/senders', { cookie: cookieA, method: 'POST' });
    expect(sender.status).toBe(201);
    senderId = ((await sender.json()) as { id: string }).id;

    const res = await call('/api/campaigns', {
      cookie: cookieA,
      body: campaign({
        subject: 'Quarterly report',
        body: '<p style="text-align:center;color:red">Numbers <script>alert(1)</script><strong>attached</strong></p>',
        recipients: ['q1@example.com', 'q2@example.com', 'q3@example.com'],
        senderId,
        attachments: [{ filename: 'pixel.png', contentType: 'image/png', dataBase64: PNG_BASE64 }, file('notes.html', 20, 'text/html')],
      }),
    });
    expect(res.status).toBe(201);
    const list = (await (await call('/api/emails/scheduled?limit=50', { cookie: cookieA })).json()) as { items: { id: string; recipient: string }[] };
    emailId = list.items.find((item) => item.recipient === 'q1@example.com')!.id;
  });

  it('uses the chosen sender for every email', async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT sender_id FROM emails WHERE user_id = $1 AND recipient LIKE 'q%@example.com'",
      [userA],
    );
    expect(rows).toEqual([{ sender_id: senderId }]);
  });

  it('lists items in the shared shape, with filters', async () => {
    const res = await call(`/api/emails/scheduled?senderId=${senderId}&limit=2&page=1`, { cookie: cookieA });
    const body = (await res.json()) as { items: Record<string, unknown>[]; total: number; page: number; limit: number };

    expect(body).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(body.items).toHaveLength(2);
    expect(Object.keys(body.items[0]!).sort()).toEqual(
      ['attachmentCount', 'error', 'id', 'preview', 'recipient', 'scheduledAt', 'senderEmail', 'senderId', 'sentAt', 'status', 'subject'].sort(),
    );
    expect(body.items[0]).toMatchObject({ preview: 'Numbers attached', attachmentCount: 2, status: 'scheduled', sentAt: null, senderId });

    const none = (await (await call(`/api/emails/scheduled?senderId=${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, { cookie: cookieA })).json()) as { total: number };
    expect(none.total).toBe(0);
  });

  it('stores only sanitized HTML', async () => {
    const detail = (await (await call(`/api/emails/${emailId}`, { cookie: cookieA })).json()) as { body: string };
    expect(detail.body).toBe('<p style="text-align:center">Numbers <strong>attached</strong></p>');
  });

  it('returns the detail with sender name and attachment metadata', async () => {
    const detail = (await (await call(`/api/emails/${emailId}`, { cookie: cookieA })).json()) as Record<string, unknown>;

    expect(detail).toMatchObject({
      id: emailId,
      senderName: 'Alice Admin',
      attempts: 0,
      previewUrl: null,
      messageId: null,
      attachments: [
        { index: 0, filename: 'pixel.png', contentType: 'image/png', size: Buffer.from(PNG_BASE64, 'base64').length },
        { index: 1, filename: 'notes.html', contentType: 'text/html', size: 20 },
      ],
    });
  });

  it('streams attachments: images inline, everything else as a download', async () => {
    const image = await call(`/api/emails/${emailId}/attachments/0`, { cookie: cookieA });
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('content-disposition')).toMatch(/^inline/);
    expect(Buffer.from(await image.arrayBuffer()).toString('base64')).toBe(PNG_BASE64);

    const html = await call(`/api/emails/${emailId}/attachments/1`, { cookie: cookieA });
    expect(html.headers.get('content-type')).toBe('application/octet-stream'); // never rendered by the browser
    expect(html.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('hides emails and attachments from other users', async () => {
    expect((await call(`/api/emails/${emailId}`, { cookie: cookieB })).status).toBe(404);
    expect((await call(`/api/emails/${emailId}/attachments/0`, { cookie: cookieB })).status).toBe(404);
    expect((await call(`/api/emails/${emailId}/attachments/9`, { cookie: cookieA })).status).toBe(404);
    expect((await call('/api/emails/not-a-uuid', { cookie: cookieA })).status).toBe(404);
  });

  it('searches in the same shape and honours status and sender filters', async () => {
    const found = (await (await call(`/api/search?q=q2&status=scheduled,processing&senderId=${senderId}`, { cookie: cookieA })).json()) as {
      source: string;
      items: { recipient: string }[];
      total: number;
      page: number;
      limit: number;
    };
    expect(found).toMatchObject({ source: 'sql', total: 1, page: 1, limit: 20 });
    expect(found.items[0]).toMatchObject({ recipient: 'q2@example.com', preview: 'Numbers attached', attachmentCount: 2 });

    const sentOnly = (await (await call('/api/search?q=q2&status=sent,failed', { cookie: cookieA })).json()) as { total: number };
    expect(sentOnly.total).toBe(0);
    expect((await call('/api/search?status=bogus', { cookie: cookieA })).status).toBe(400);
  });

  it('filters the sent list by sent or failed', async () => {
    await pool.query("UPDATE emails SET status = 'sent', sent_at = now() WHERE id = $1", [emailId]);
    await pool.query("UPDATE emails SET status = 'failed', sent_at = now(), error = 'boom' WHERE user_id = $1 AND recipient = 'q2@example.com'", [userA]);

    const sent = (await (await call('/api/emails/sent?status=sent', { cookie: cookieA })).json()) as { items: { id: string }[] };
    expect(sent.items.map((i) => i.id)).toEqual([emailId]);
    const failed = (await (await call('/api/emails/sent?status=failed', { cookie: cookieA })).json()) as { items: { error: string }[] };
    expect(failed.items[0]!.error).toBe('boom');
    const all = (await (await call('/api/emails/sent', { cookie: cookieA })).json()) as { total: number };
    expect(all.total).toBe(2);
  });
});

describe('DELETE /api/emails/:id', () => {
  it('cancels a scheduled email and removes its job; refuses anything else with 409', async () => {
    await call('/api/campaigns', { cookie: cookieB, body: campaign({ recipients: ['cancel1@example.com', 'cancel2@example.com'] }) });
    const rows = (await pool.query<{ id: string; recipient: string }>('SELECT id, recipient FROM emails WHERE user_id = $1 ORDER BY recipient', [userB])).rows;
    const [first, second] = rows;
    expect(await emailQueue.getJob(first!.id)).toBeTruthy();

    const res = await call(`/api/emails/${first!.id}`, { cookie: cookieB, method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await pool.query('SELECT 1 FROM emails WHERE id = $1', [first!.id])).rowCount).toBe(0);
    expect(await emailQueue.getJob(first!.id)).toBeFalsy();

    const again = await call(`/api/emails/${first!.id}`, { cookie: cookieB, method: 'DELETE' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toMatch(/still scheduled/);

    await pool.query("UPDATE emails SET status = 'processing' WHERE id = $1", [second!.id]);
    expect((await call(`/api/emails/${second!.id}`, { cookie: cookieB, method: 'DELETE' })).status).toBe(409);
    expect((await call(`/api/emails/${second!.id}`, { cookie: cookieA, method: 'DELETE' })).status).toBe(409); // not theirs
    expect((await pool.query('SELECT 1 FROM emails WHERE id = $1', [second!.id])).rowCount).toBe(1);
  });
});

describe('senders, stats and CORS', () => {
  it('lists active senders and creates more, up to a cap', async () => {
    const before = (await (await call('/api/senders', { cookie: cookieB })).json()) as { id: string; email: string; displayName: string }[];
    expect(before[0]).toMatchObject({ displayName: 'Bob Other' });
    expect(Object.keys(before[0]!).sort()).toEqual(['displayName', 'email', 'id']);

    await pool.query('UPDATE senders SET active = false WHERE id = $1', [before[0]!.id]);
    const after = (await (await call('/api/senders', { cookie: cookieB })).json()) as unknown[];
    expect(after).toHaveLength(before.length - 1); // inactive senders are not listed

    for (let i = 0; i < 12; i += 1) {
      const res = await call('/api/senders', { cookie: cookieB, method: 'POST' });
      if (res.status === 409) {
        expect(((await res.json()) as { error: string }).error).toBe('sender_limit_reached');
        return;
      }
      expect(res.status).toBe(201);
    }
    throw new Error('sender cap was never reached');
  });

  it('returns scheduled, sent and failed counts', async () => {
    const stats = await (await call('/api/stats', { cookie: cookieA })).json();
    expect(stats).toEqual({ scheduled: await countScheduled(userA), sent: 1, failed: 1 });
  });

  it('allows GET, POST and DELETE with credentials from the frontend origin only', async () => {
    const preflight = await fetch(`${base}/api/emails/x`, {
      method: 'OPTIONS',
      headers: { origin: FRONTEND, 'access-control-request-method': 'DELETE' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET,POST,DELETE');

    const stranger = await fetch(`${base}/api/stats`, { headers: { origin: 'https://evil.example' } });
    // A single configured origin is always echoed, never the caller's: browsers reject the mismatch.
    expect(stranger.headers.get('access-control-allow-origin')).toBe(FRONTEND);
  });
});

async function countScheduled(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM emails WHERE user_id = $1 AND status IN ('scheduled', 'processing')",
    [userId],
  );
  return rows[0]!.count;
}
