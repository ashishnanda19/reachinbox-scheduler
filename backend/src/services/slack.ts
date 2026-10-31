import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const SLACK_WEBHOOK_TIMEOUT_MS = 5000;
const REVOKED_WEBHOOK_STATUSES = new Set([404, 410]);

export interface RateLimitNotice {
  userId: string;
  senderEmail: string;
  limit: number;
  nextWindowAt: Date;
  /** Emails of this sender already pushed to a later window, when known. */
  delayedCount?: number;
}

const istFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export function formatRateLimitMessage(notice: RateLimitNotice): string {
  const lines = [
    ':warning: *Hourly sending limit reached*',
    `*Sender:* ${notice.senderEmail}`,
    `*Limit hit:* ${notice.limit} emails per hour`,
  ];
  if (notice.delayedCount !== undefined) lines.push(`*Emails delayed so far:* ${notice.delayedCount}`);
  lines.push(
    `*Sending resumes:* ${notice.nextWindowAt.toISOString()} (UTC) / ${istFormat.format(notice.nextWindowAt)} IST`,
    'Nothing is lost: delayed emails are rescheduled into the next hour window.',
  );
  return lines.join('\n');
}

/** Cheap pre-check so callers do not spend a once-per-window alert slot when there is nowhere to send it. */
export async function hasSlackConnection(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM slack_connections WHERE user_id = $1', [userId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Posts the rate-limit alert to the user's connected Slack channel. The connection is looked up at alert
 * time, so connecting (or disconnecting) takes effect immediately with no redeploy. Never throws.
 */
export async function notifyRateLimit(notice: RateLimitNotice): Promise<void> {
  try {
    const { rows } = await pool.query<{ webhook_url: string }>(
      'SELECT webhook_url FROM slack_connections WHERE user_id = $1',
      [notice.userId],
    );
    const webhookUrl = rows[0]?.webhook_url;
    if (!webhookUrl) {
      logger.debug({ userId: notice.userId }, 'rate limit hit but Slack is not connected, skipping notification');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SLACK_WEBHOOK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: formatRateLimitMessage(notice) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      logger.info({ userId: notice.userId }, `SLACK alert sent for ${notice.senderEmail}`);
    } else if (REVOKED_WEBHOOK_STATUSES.has(response.status)) {
      // Webhook was revoked or the channel deleted: drop it so we stop trying. Match the URL so a
      // connection made a moment ago is not removed by mistake.
      await pool.query('DELETE FROM slack_connections WHERE user_id = $1 AND webhook_url = $2', [notice.userId, webhookUrl]);
      logger.warn({ userId: notice.userId, status: response.status }, 'Slack webhook revoked, connection removed');
    } else {
      logger.warn({ userId: notice.userId, status: response.status }, 'Slack webhook returned an error');
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId: notice.userId }, 'Slack notification failed (ignored)');
  }
}
