import { pool } from '../db/pool.js';

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

// Small LRU keyed by campaign id: a campaign's 1000 jobs share one read instead of re-reading the same bytes.
// Capped by entry count because each entry holds up to 5 MB.
const MAX_CACHED_CAMPAIGNS = 8;
const cache = new Map<string, Promise<MailAttachment[]>>();

export function getCampaignAttachments(campaignId: string): Promise<MailAttachment[]> {
  const hit = cache.get(campaignId);
  if (hit) {
    cache.delete(campaignId); // refresh recency
    cache.set(campaignId, hit);
    return hit;
  }

  const loading = pool
    .query<{ filename: string; content_type: string; data: Buffer }>(
      'SELECT filename, content_type, data FROM campaign_attachments WHERE campaign_id = $1 ORDER BY position',
      [campaignId],
    )
    .then(({ rows }) => rows.map((r) => ({ filename: r.filename, contentType: r.content_type, content: r.data })));

  cache.set(campaignId, loading);
  loading.catch(() => cache.delete(campaignId)); // never cache a failure
  if (cache.size > MAX_CACHED_CAMPAIGNS) cache.delete(cache.keys().next().value!);
  return loading;
}

export function clearAttachmentCache(): void {
  cache.clear();
}
