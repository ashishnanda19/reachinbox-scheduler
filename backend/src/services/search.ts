import { Client } from '@elastic/elasticsearch';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { ITEM_SELECT, toItem, type EmailItem, type EmailItemRow } from './emailItems.js';

// Elasticsearch is a read-side convenience: every call here is best effort and must never block or
// fail scheduling/sending. Postgres stays the source of truth (POST /api/search/reindex repairs drift).

const ES_REQUEST_TIMEOUT_MS = 3000;
const BULK_BATCH_SIZE = 1000;
// After a failure, skip indexing for a short while instead of hammering a down cluster.
const CIRCUIT_OPEN_MS = 10_000;
const FAILURE_LOG_INTERVAL_MS = 30_000;

const client = config.ELASTICSEARCH_URL
  ? new Client({ node: config.ELASTICSEARCH_URL, requestTimeout: ES_REQUEST_TIMEOUT_MS, maxRetries: 1 })
  : null;

export interface SearchResult {
  source: 'elasticsearch' | 'sql';
  items: EmailItem[];
  total: number;
  page: number;
  limit: number;
}

export interface SearchParams {
  userId: string;
  q: string;
  /** Any of scheduled, processing, sent, failed. */
  statuses?: string[];
  senderId?: string;
  page: number;
  limit: number;
}

interface EmailDoc {
  id: string;
  userId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  senderEmail: string;
}

interface EmailRowForIndex {
  id: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: Date;
  sent_at: Date | null;
  sender_email: string;
}

const SELECT_FOR_INDEX = `
  SELECT e.id, e.user_id, e.recipient, e.subject, e.body, e.status, e.scheduled_at, e.sent_at, s.email AS sender_email
    FROM emails e JOIN senders s ON s.id = e.sender_id`;

export const searchEnabled = client !== null;

// ---- failure handling -------------------------------------------------------------------------

let circuitOpenUntil = 0;
let lastFailureLogAt = 0;

function recordFailure(action: string, err: unknown): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  indexReady = null; // re-check the index once the cluster is back
  if (Date.now() - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
    lastFailureLogAt = Date.now();
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      `elasticsearch ${action} failed (ignored: sending is not affected; SQL search still works)`,
    );
  }
}

const circuitClosed = (): boolean => Date.now() >= circuitOpenUntil;

// ---- index management -------------------------------------------------------------------------

let indexReady: Promise<void> | null = null;

async function createIndexIfMissing(es: Client): Promise<void> {
  const index = config.ELASTICSEARCH_INDEX;
  if (await es.indices.exists({ index })) return;
  try {
    await es.indices.create({
      index,
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          userId: { type: 'keyword' },
          recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
          subject: { type: 'text' },
          body: { type: 'text' },
          status: { type: 'keyword' },
          scheduledAt: { type: 'date' },
          sentAt: { type: 'date' },
          senderEmail: { type: 'keyword' },
        },
      },
    });
    logger.info({ index }, 'created elasticsearch index');
  } catch (err) {
    // The API and a separate worker process can race to create it.
    if ((err as { meta?: { body?: { error?: { type?: string } } } }).meta?.body?.error?.type !== 'resource_already_exists_exception') {
      throw err;
    }
  }
}

function ensureIndex(es: Client): Promise<void> {
  indexReady ??= createIndexIfMissing(es).catch((err) => {
    indexReady = null;
    throw err;
  });
  return indexReady;
}

/** Called on boot of the API and the worker. Never throws and never delays startup. */
export async function initSearch(): Promise<void> {
  if (!client) {
    logger.info('ELASTICSEARCH_URL is empty: search will use SQL');
    return;
  }
  try {
    await ensureIndex(client);
  } catch (err) {
    recordFailure('index setup', err);
  }
}

// ---- indexing ---------------------------------------------------------------------------------

const toDoc = (row: EmailRowForIndex): EmailDoc => ({
  id: row.id,
  userId: row.user_id,
  recipient: row.recipient,
  subject: row.subject,
  body: row.body,
  status: row.status,
  scheduledAt: row.scheduled_at.toISOString(),
  sentAt: row.sent_at ? row.sent_at.toISOString() : null,
  senderEmail: row.sender_email,
});

/** Upserts documents by email id. Throws on failure; callers decide whether that matters. */
async function bulkIndex(es: Client, rows: EmailRowForIndex[]): Promise<void> {
  if (rows.length === 0) return;
  await ensureIndex(es);
  const operations = rows.flatMap((row) => [{ index: { _index: config.ELASTICSEARCH_INDEX, _id: row.id } }, toDoc(row)]);
  const response = await es.bulk({ operations });
  if (response.errors) {
    const failed = response.items.filter((item) => item.index?.error).length;
    throw new Error(`${failed} of ${rows.length} documents failed to index`);
  }
}

async function indexRows(where: string, params: unknown[]): Promise<void> {
  if (!client || !circuitClosed()) return;
  try {
    const { rows } = await pool.query<EmailRowForIndex>(`${SELECT_FOR_INDEX} WHERE ${where}`, params);
    for (let i = 0; i < rows.length; i += BULK_BATCH_SIZE) {
      await bulkIndex(client, rows.slice(i, i + BULK_BATCH_SIZE));
    }
  } catch (err) {
    recordFailure('indexing', err);
  }
}

/** Fire-and-forget: (re)index one email after a status change. */
export function trackEmailChange(emailId: string): void {
  void indexRows('e.id = $1', [emailId]);
}

/** Fire-and-forget: index every email of a freshly created campaign, in bulk. */
export function trackCampaign(campaignId: string): void {
  void indexRows('e.campaign_id = $1', [campaignId]);
}

/** Fire-and-forget: drop a cancelled email from the index. */
export function removeFromIndex(emailId: string): void {
  if (!client || !circuitClosed()) return;
  client.delete({ index: config.ELASTICSEARCH_INDEX, id: emailId }, { ignore: [404] }).catch((err) => recordFailure('delete', err));
}

export class SearchUnavailableError extends Error {}

/** Re-index all of a user's emails from Postgres. Explicit, so it reports failures instead of hiding them. */
export async function reindexUserEmails(userId: string): Promise<number> {
  if (!client) throw new SearchUnavailableError('ELASTICSEARCH_URL is not configured');
  let indexed = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';
  try {
    for (;;) {
      const { rows } = await pool.query<EmailRowForIndex>(
        `${SELECT_FOR_INDEX} WHERE e.user_id = $1 AND e.id > $2 ORDER BY e.id LIMIT $3`,
        [userId, lastId, BULK_BATCH_SIZE],
      );
      if (rows.length === 0) break;
      await bulkIndex(client, rows);
      indexed += rows.length;
      lastId = rows[rows.length - 1]!.id;
    }
  } catch (err) {
    throw new SearchUnavailableError(`elasticsearch unavailable: ${(err as Error).message}`);
  }
  circuitOpenUntil = 0;
  return indexed;
}

// ---- search -----------------------------------------------------------------------------------

async function hydrate(userId: string, ids: string[]): Promise<EmailItem[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<EmailItemRow>(`${ITEM_SELECT} WHERE e.user_id = $1 AND e.id = ANY($2::uuid[])`, [userId, ids]);
  const byId = new Map(rows.map((row) => [row.id, toItem(row)]));
  // Postgres is the source of truth: ids Elasticsearch still knows but Postgres no longer has (cancelled) drop out.
  return ids.flatMap((id) => byId.get(id) ?? []);
}

async function searchElasticsearch(es: Client, params: SearchParams): Promise<SearchResult> {
  await ensureIndex(es);
  const filter: object[] = [{ term: { userId: params.userId } }];
  if (params.statuses?.length) filter.push({ terms: { status: params.statuses } });
  if (params.senderId) {
    const sender = await pool.query<{ email: string }>('SELECT email FROM senders WHERE id = $1 AND user_id = $2', [
      params.senderId,
      params.userId,
    ]);
    if (!sender.rows[0]) return { source: 'elasticsearch', items: [], total: 0, page: params.page, limit: params.limit };
    filter.push({ term: { senderEmail: sender.rows[0].email } });
  }

  const response = await es.search({
    index: config.ELASTICSEARCH_INDEX,
    from: (params.page - 1) * params.limit,
    size: params.limit,
    _source: false,
    query: {
      bool: {
        filter,
        must: params.q
          ? // bool_prefix: the last term matches as a prefix, so typing "lead0" finds lead04@example.com. `and`: every term must
          // match, so "lead07.abc" (analyzed into two terms) finds one recipient, not everything containing either term.
            [{ multi_match: { query: params.q, type: 'bool_prefix', operator: 'and', fields: ['recipient', 'subject', 'body'] } }]
          : [{ match_all: {} }],
      },
    },
    sort: [{ _score: { order: 'desc' } }, { scheduledAt: { order: 'desc' } }],
  });

  const total = typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0);
  const ids = response.hits.hits.flatMap((hit) => (hit._id ? [hit._id] : []));
  return { source: 'elasticsearch', items: await hydrate(params.userId, ids), total, page: params.page, limit: params.limit };
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

async function searchSql(params: SearchParams): Promise<SearchResult> {
  const pattern = `%${escapeLike(params.q)}%`;
  const where = `e.user_id = $1
    AND ($2::text[] IS NULL OR e.status = ANY($2))
    AND ($3::uuid IS NULL OR e.sender_id = $3)
    AND ($4::text = '' OR e.recipient ILIKE $5 OR e.subject ILIKE $5 OR e.body ILIKE $5)`;
  const filterParams = [params.userId, params.statuses?.length ? params.statuses : null, params.senderId ?? null, params.q, pattern];

  const [rows, count] = await Promise.all([
    pool.query<EmailItemRow>(`${ITEM_SELECT} WHERE ${where} ORDER BY e.scheduled_at DESC, e.id LIMIT $6 OFFSET $7`, [
      ...filterParams,
      params.limit,
      (params.page - 1) * params.limit,
    ]),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM emails e WHERE ${where}`, filterParams),
  ]);
  return { source: 'sql', items: rows.rows.map(toItem), total: count.rows[0]!.total, page: params.page, limit: params.limit };
}

/** Elasticsearch when configured and healthy, otherwise SQL ILIKE on the same fields: always answers. */
export async function searchEmails(params: SearchParams): Promise<SearchResult> {
  if (client && circuitClosed()) {
    try {
      return await searchElasticsearch(client, params);
    } catch (err) {
      recordFailure('search', err);
    }
  }
  return searchSql(params);
}
