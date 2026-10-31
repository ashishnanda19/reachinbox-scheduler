import { config } from '../config.js';
import { pool } from '../db/pool.js';

export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface EmailRow {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: string;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  status: EmailStatus;
  attempts: number;
  sent_at: Date | null;
  error: string | null;
  message_id: string | null;
  created_at: Date;
  processing_started_at: Date | null;
  position: number;
}

// A 'processing' claim older than STALE_PROCESSING_MS belongs to a crashed worker.
const CLAIM_IS_STALE = `(processing_started_at IS NULL
  OR processing_started_at <= now() - ($2::int * interval '1 millisecond'))`;

/**
 * Atomic claim: the idempotency guarantee. Exactly one caller wins per email, no matter how many
 * workers or duplicate jobs race for it. Returns null if the email is not claimable (already
 * claimed, sent or failed). A stale 'processing' claim (crashed worker) can be taken over.
 */
export async function claimEmail(id: string): Promise<EmailRow | null> {
  const { rows } = await pool.query<EmailRow>(
    `UPDATE emails
        SET status = 'processing', attempts = attempts + 1, processing_started_at = now()
      WHERE id = $1
        AND (status = 'scheduled' OR (status = 'processing' AND ${CLAIM_IS_STALE}))
      RETURNING *`,
    [id, config.STALE_PROCESSING_MS],
  );
  return rows[0] ?? null;
}

/** Undo a claim that did not result in a send attempt (e.g. the sender gate was busy). */
export async function releaseEmail(id: string): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'scheduled', attempts = GREATEST(attempts - 1, 0), processing_started_at = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id],
  );
}

/** Transient failure: back to 'scheduled' so the BullMQ retry can claim it again. */
export async function requeueEmail(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'scheduled', error = $2, processing_started_at = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id, error],
  );
}

export async function markSent(id: string, messageId: string, previewUrl: string | null = null): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, error = NULL, processing_started_at = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id, messageId, previewUrl],
  );
}

// sent_at doubles as "time of the final attempt" for failed rows so the Sent list can show and sort them.
export async function markFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'failed', sent_at = now(), error = $2, processing_started_at = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id, error],
  );
}

export interface EmailState {
  status: EmailStatus;
  /** Milliseconds until a 'processing' claim becomes stale (0 if already stale or not processing). */
  staleInMs: number;
}

export async function getEmailState(id: string): Promise<EmailState | null> {
  const { rows } = await pool.query<{ status: EmailStatus; stale_in_ms: number }>(
    `SELECT status,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM
              (processing_started_at + ($2::int * interval '1 millisecond') - now())) * 1000))::int AS stale_in_ms
       FROM emails WHERE id = $1`,
    [id, config.STALE_PROCESSING_MS],
  );
  const row = rows[0];
  return row ? { status: row.status, staleInMs: row.stale_in_ms ?? 0 } : null;
}

export interface CampaignPacing {
  hourly_limit: number;
  delay_between_ms: number;
  start_time: Date;
}

export async function getCampaignPacing(campaignId: string): Promise<CampaignPacing> {
  const { rows } = await pool.query<CampaignPacing>(
    'SELECT hourly_limit, delay_between_ms, start_time FROM campaigns WHERE id = $1',
    [campaignId],
  );
  const pacing = rows[0];
  if (!pacing) throw new Error(`campaign ${campaignId} not found`);
  return pacing;
}

/** Stable rank: how many earlier emails of this campaign share the sender (any status, so it never shifts). */
export async function getSenderRank(email: Pick<EmailRow, 'campaign_id' | 'sender_id' | 'position'>): Promise<number> {
  const { rows } = await pool.query<{ rank: number }>(
    `SELECT count(*)::int AS rank FROM emails
      WHERE campaign_id = $1 AND sender_id = $2 AND position < $3`,
    [email.campaign_id, email.sender_id, email.position],
  );
  return rows[0]!.rank;
}

/** Rate limited: stays 'scheduled' (no extra status) with its true new run time, and the claim is undone. */
export async function rescheduleEmail(id: string, scheduledAt: Date): Promise<void> {
  await pool.query(
    `UPDATE emails
        SET status = 'scheduled', scheduled_at = $2, attempts = GREATEST(attempts - 1, 0), processing_started_at = NULL
      WHERE id = $1 AND status = 'processing'`,
    [id, scheduledAt],
  );
}

/** Emails of this sender already queued for the given time or later (i.e. pushed to a later window). */
export async function countDelayedForSender(senderId: string, from: Date): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM emails WHERE sender_id = $1 AND status = 'scheduled' AND scheduled_at >= $2",
    [senderId, from],
  );
  return rows[0]!.count;
}

/**
 * Cancel an email, but only while it is still 'scheduled'. One atomic statement, so it cannot race the
 * worker's claim: whichever of cancel and claim reaches the row first wins and the other finds nothing.
 */
export async function cancelScheduledEmail(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM emails WHERE id = $1 AND user_id = $2 AND status = 'scheduled' RETURNING id",
    [id, userId],
  );
  return rowCount === 1;
}
