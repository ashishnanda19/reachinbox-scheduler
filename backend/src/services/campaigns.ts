import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { enqueueEmails, type SchedulableEmail } from '../scheduler/queue.js';
import { trackCampaign } from './search.js';
import { logger } from '../utils/logger.js';
import { ensureSenders, getActiveSender } from './senders.js';
import type { Sender } from './senders.js';

export interface CampaignInput {
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenMs: number;
  hourlyLimit: number;
  /** When set, every email uses this sender instead of round-robin. */
  senderId?: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

export class InvalidSenderError extends Error {}

export interface CreatedCampaign {
  id: string;
  total: number;
  /** The limit actually stored: the requested one, capped at MAX_EMAILS_PER_HOUR_PER_SENDER. */
  hourlyLimit: number;
  firstScheduledAt: Date;
  lastScheduledAt: Date;
  /** false if Redis was unreachable after COMMIT; the boot reconciler will enqueue the jobs. */
  enqueued: boolean;
}

export async function createCampaign(userId: string, input: CampaignInput): Promise<CreatedCampaign> {
  let senders: Sender[];
  if (input.senderId) {
    const chosen = await getActiveSender(userId, input.senderId);
    if (!chosen) throw new InvalidSenderError('senderId does not belong to you or is not active');
    senders = [chosen];
  } else {
    senders = (await ensureSenders(userId)).filter((sender) => sender.active);
  }

  // Round-robin senders; spread sends delayBetweenMs apart starting at startTime.
  const senderIds: string[] = [];
  const scheduledAts: string[] = [];
  const positions: number[] = [];
  input.recipients.forEach((_recipient, index) => {
    senderIds.push(senders[index % senders.length]!.id);
    positions.push(index);
    scheduledAts.push(new Date(input.startTime.getTime() + index * input.delayBetweenMs).toISOString());
  });

  const effectiveHourlyLimit = Math.min(input.hourlyLimit, config.MAX_EMAILS_PER_HOUR_PER_SENDER);

  const client = await pool.connect();
  let campaignId: string;
  let emails: SchedulableEmail[];
  try {
    await client.query('BEGIN');
    const campaign = await client.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, subject, body, start_time, delay_between_ms, hourly_limit, total_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        userId,
        input.subject,
        input.body,
        input.startTime,
        input.delayBetweenMs,
        effectiveHourlyLimit,
        input.recipients.length,
      ],
    );
    campaignId = campaign.rows[0]!.id;

    const inserted = await client.query<SchedulableEmail>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, recipient, subject, body, scheduled_at, position)
       SELECT $1, $2, t.sender_id, t.recipient, $3, $4, t.scheduled_at, t.position
         FROM unnest($5::uuid[], $6::text[], $7::timestamptz[], $8::int[])
           AS t(sender_id, recipient, scheduled_at, position)
       RETURNING id, scheduled_at`,
      [campaignId, userId, input.subject, input.body, senderIds, input.recipients, scheduledAts, positions],
    );
    emails = inserted.rows;

    for (const [position, file] of (input.attachments ?? []).entries()) {
      await client.query(
        `INSERT INTO campaign_attachments (campaign_id, position, filename, content_type, size, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [campaignId, position, file.filename, file.contentType, file.content.length, file.content],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  let enqueued = true;
  try {
    await enqueueEmails(emails);
  } catch (err) {
    enqueued = false;
    logger.error({ err, campaignId }, 'enqueue failed after commit; reconciler will repair on next worker boot');
  }

  trackCampaign(campaignId); // fire-and-forget: Elasticsearch trouble never affects scheduling

  const times = emails.map((e) => e.scheduled_at.getTime());
  return {
    id: campaignId,
    total: emails.length,
    hourlyLimit: effectiveHourlyLimit,
    firstScheduledAt: new Date(Math.min(...times)),
    lastScheduledAt: new Date(Math.max(...times)),
    enqueued,
  };
}
