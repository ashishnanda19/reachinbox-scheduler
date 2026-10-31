import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Integration test (Postgres from docker-compose). config reads the environment once at import, so each
// scenario re-imports the modules with ELASTICSEARCH_URL set the way it needs.
type Modules = { search: typeof import('./search.js'); pool: typeof import('../db/pool.js').pool };

async function load(elasticsearchUrl: string): Promise<Modules> {
  vi.resetModules();
  vi.stubEnv('ELASTICSEARCH_URL', elasticsearchUrl);
  return {
    search: await import('./search.js'),
    pool: (await import('../db/pool.js')).pool,
  };
}

const pools: Modules['pool'][] = [];
let userId: string;
let otherUserId: string;

async function seed(pool: Modules['pool']): Promise<void> {
  const insertUser = async (googleId: string) =>
    (await pool.query<{ id: string }>(
      "INSERT INTO users (google_id, email, name) VALUES ($1, 'search@example.com', 'Search') RETURNING id", [googleId],
    )).rows[0]!.id;
  userId = await insertUser('vitest-search-a');
  otherUserId = await insertUser('vitest-search-b');

  const insertSender = async (id: string) =>
    (await pool.query<{ id: string }>(
      `INSERT INTO senders (user_id, email, smtp_host, smtp_port, smtp_user, smtp_pass)
       VALUES ($1, 'sender@example.com', 'localhost', 25, 'u', 'p') RETURNING id`, [id],
    )).rows[0]!.id;
  const insertCampaign = async (id: string) =>
    (await pool.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, subject, body, start_time, delay_between_ms, hourly_limit, total_count)
       VALUES ($1, 's', 'b', now(), 0, 1, 1) RETURNING id`, [id],
    )).rows[0]!.id;
  const [senderId, otherSenderId] = [await insertSender(userId), await insertSender(otherUserId)];
  const [campaignId, otherCampaignId] = [await insertCampaign(userId), await insertCampaign(otherUserId)];

  const insertEmail = (u: string, c: string, s: string, recipient: string, subject: string, body: string, status: string, minutesFromNow: number) =>
    pool.query(
      `INSERT INTO emails (campaign_id, user_id, sender_id, recipient, subject, body, status, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' minutes')::interval)`,
      [c, u, s, recipient, subject, body, status, String(minutesFromNow)],
    );
  await insertEmail(userId, campaignId, senderId, 'alice@acme.com', 'Your invoice is ready', 'Hello Alice', 'scheduled', 1);
  await insertEmail(userId, campaignId, senderId, 'bob@globex.com', 'Welcome aboard', 'See the attached INVOICE for details', 'sent', 2);
  await insertEmail(userId, campaignId, senderId, 'carol@initech.com', 'Discount 100% off', 'Use code SAVE_NOW', 'failed', 3);
  await insertEmail(userId, campaignId, senderId, 'dave@initech.com', 'Hello', 'Nothing special', 'scheduled', 4);
  await insertEmail(otherUserId, otherCampaignId, otherSenderId, 'mallory@evil.com', 'Secret invoice', 'other tenant', 'scheduled', 5);
}

const run = (search: Modules['search'], overrides: Partial<Parameters<Modules['search']['searchEmails']>[0]> = {}) =>
  search.searchEmails({ userId, q: '', page: 1, limit: 20, ...overrides });

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const pool = pools[0]!;
  await pool.query("DELETE FROM users WHERE google_id LIKE 'vitest-search-%'");
  await Promise.all(pools.map((p) => p.end()));
});

describe('search with ELASTICSEARCH_URL empty (SQL fallback)', () => {
  let search: Modules['search'];

  beforeAll(async () => {
    const modules = await load('');
    pools.push(modules.pool);
    search = modules.search;
    await seed(modules.pool);
  });

  it('is disabled and answers from SQL', async () => {
    expect(search.searchEnabled).toBe(false);
    expect((await run(search)).source).toBe('sql');
  });

  it('matches subject, body and recipient case-insensitively', async () => {
    const result = await run(search, { q: 'invoice' });
    expect(result.items.map((h) => h.recipient).sort()).toEqual(['alice@acme.com', 'bob@globex.com']); // subject + body
    expect((await run(search, { q: 'GLOBEX' })).items.map((h) => h.recipient)).toEqual(['bob@globex.com']); // recipient
  });

  it('never returns another tenant\'s emails', async () => {
    const result = await run(search, { q: 'invoice' });
    expect(result.items.map((h) => h.recipient)).not.toContain('mallory@evil.com');
    expect(result.total).toBe(2);
  });

  it('filters by status', async () => {
    const result = await run(search, { statuses: ['failed'] });
    expect(result.items.map((h) => h.recipient)).toEqual(['carol@initech.com']);
    expect((await run(search, { q: 'invoice', statuses: ['sent'] })).items).toHaveLength(1);
  });

  it('treats % and _ in the query literally', async () => {
    expect((await run(search, { q: '100%' })).items.map((h) => h.recipient)).toEqual(['carol@initech.com']);
    expect((await run(search, { q: 'SAVE_NOW' })).items).toHaveLength(1);
    expect((await run(search, { q: 'SAVE_NOW'.replace('_', 'X') })).items).toHaveLength(0); // "_" is not a wildcard
    expect((await run(search, { q: '%' })).items.map((h) => h.recipient)).toEqual(['carol@initech.com']);
  });

  it('paginates and reports totals', async () => {
    const first = await run(search, { limit: 3, page: 1 });
    const second = await run(search, { limit: 3, page: 2 });
    expect(first).toMatchObject({ total: 4, page: 1, limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
  });

  it('indexing calls are harmless no-ops and reindex reports it is not configured', async () => {
    expect(() => search.trackEmailChange('00000000-0000-0000-0000-000000000000')).not.toThrow();
    await expect(search.reindexUserEmails(userId)).rejects.toBeInstanceOf(search.SearchUnavailableError);
  });
});

describe('search when Elasticsearch is configured but down', () => {
  it('falls back to SQL instead of failing', async () => {
    const { search, pool } = await load('http://127.0.0.1:1'); // nothing listens here
    pools.push(pool);

    expect(search.searchEnabled).toBe(true);
    const result = await run(search, { q: 'invoice' });

    expect(result.source).toBe('sql');
    expect(result.total).toBe(2);
  });

  it('keeps indexing calls non-throwing', async () => {
    const { search, pool } = await load('http://127.0.0.1:1');
    pools.push(pool);

    expect(() => search.trackCampaign('00000000-0000-0000-0000-000000000000')).not.toThrow();
    await expect(search.initSearch()).resolves.toBeUndefined();
  });
});
