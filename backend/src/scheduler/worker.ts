import { DelayedError, type Job, UnrecoverableError, Worker } from 'bullmq';
import { config } from '../config.js'; // must precede nodemailer: it disables nodemailer's test-account cache
import nodemailer, { type Transporter } from 'nodemailer';
import { pool } from '../db/pool.js';
import { createRedisConnection, redis } from '../lib/redis.js';
import type { Sender } from '../services/senders.js';
import { htmlToText } from '../lib/html.js';
import { trackEmailChange } from '../services/search.js';
import { hasSlackConnection, notifyRateLimit } from '../services/slack.js';
import { logger } from '../utils/logger.js';
import {
  claimEmail,
  countDelayedForSender,
  getCampaignPacing,
  getEmailState,
  getSenderRank,
  markFailed,
  markSent,
  releaseEmail,
  requeueEmail,
  rescheduleEmail,
  type EmailRow,
} from './emails.js';
import { getCampaignAttachments } from './attachments.js';
import { computeRescheduleTime, effectiveLimit, HOUR_MS, nextWindowStart } from './hourWindow.js';
import type { EmailJobData } from './queue.js';
import { acquireSendSlot, claimRateLimitNotice, refundSendSlot, type SendSlot } from './rateLimiter.js';

// Must stay well below STALE_PROCESSING_MS so a hung SMTP call never outlives its claim.
const SMTP_TIMEOUT_MS = 15_000;
const MARK_SENT_ATTEMPTS = 3;

const senderCache = new Map<string, { sender: Sender; transporter: Transporter }>();

async function getSender(senderId: string) {
  const cached = senderCache.get(senderId);
  if (cached) return cached;

  const { rows } = await pool.query<Sender>('SELECT * FROM senders WHERE id = $1', [senderId]);
  const sender = rows[0];
  if (!sender) throw new UnrecoverableError(`sender ${senderId} not found`);

  const transporter = nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    secure: sender.smtp_port === 465,
    auth: { user: sender.smtp_user, pass: sender.smtp_pass },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  const entry = { sender, transporter };
  senderCache.set(senderId, entry);
  return entry;
}

/** Move the job back to the delayed set instead of sleeping in the worker. */
async function delayJob(job: Job<EmailJobData>, token: string | undefined, delayMs: number): Promise<never> {
  await job.moveToDelayed(Date.now() + delayMs, token);
  throw new DelayedError();
}

function isPermanentError(err: unknown): boolean {
  const { responseCode, code } = err as { responseCode?: number; code?: string };
  if (typeof responseCode === 'number') return responseCode >= 500 && responseCode < 600;
  return code === 'EENVELOPE'; // nodemailer: invalid recipient / envelope
}

async function withRetries(fn: () => Promise<void>, attempts: number): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      logger.warn({ err, attempt }, 'db write after send failed, retrying');
    }
  }
}

/** Slack alert, once per sender per window. Must never throw into the send path. */
async function notifyRateLimitOnce(email: EmailRow, sender: Sender, slot: SendSlot, limit: number): Promise<void> {
  try {
    // Without a connection there is nothing to send. Return before claiming, so the window's single alert is
    // not used up and connecting Slack mid-window still produces an alert on the next rejection.
    if (!(await hasSlackConnection(email.user_id))) return;
    if (!(await claimRateLimitNotice(sender.id, slot.window))) return;
    const nextWindowAt = new Date(nextWindowStart(slot.window * HOUR_MS));
    await notifyRateLimit({
      userId: email.user_id,
      senderEmail: sender.email,
      limit,
      nextWindowAt,
      delayedCount: await countDelayedForSender(sender.id, nextWindowAt),
    });
  } catch (err) {
    logger.warn({ err }, 'rate limit notification failed (ignored)');
  }
}

/** Over the hourly limit: push the email to its next slot instead of failing or dropping it. */
async function rescheduleRateLimited(
  job: Job<EmailJobData>,
  token: string | undefined,
  email: EmailRow,
  sender: Sender,
  slot: SendSlot,
  limit: number,
  delayBetweenMs: number,
  campaignStartMs: number,
): Promise<never> {
  const runAt = computeRescheduleTime({
    now: Date.now(),
    campaignStartMs,
    senderRank: await getSenderRank(email),
    limit,
    delayBetweenMs,
  });

  // scheduled_at is updated so the dashboard shows the true new time.
  await rescheduleEmail(email.id, new Date(runAt));
  trackEmailChange(email.id);
  logger.info(
    { senderEmail: sender.email, count: slot.count, limit },
    `RATE LIMIT sender=${sender.id} window=${slot.window} rescheduled ${email.recipient} to ${new Date(runAt).toISOString()}`,
  );
  await notifyRateLimitOnce(email, sender, slot, limit);
  return delayJob(job, token, Math.max(runAt - Date.now(), 1));
}

async function handleUnclaimed(job: Job<EmailJobData>, token: string | undefined): Promise<void> {
  const { emailId } = job.data;
  const state = await getEmailState(emailId);

  if (state?.status === 'processing') {
    // Another worker holds a fresh claim (or crashed holding it). Look again once the claim goes stale.
    logger.info(`DEFER ${emailId}: claimed by another worker, rechecking in ${state.staleInMs}ms`);
    await delayJob(job, token, Math.max(state.staleInMs, 1));
  }

  logger.info(`SKIP duplicate ${emailId}`);
}

export async function processEmail(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;

  // (a) atomic claim: only one worker can ever move this row scheduled -> processing.
  const email = await claimEmail(emailId);
  if (!email) return handleUnclaimed(job, token);

  const { sender, transporter } = await getSender(email.sender_id);

  // (a2) hourly limit: one atomic Redis call counts the send across every worker and instance.
  const pacing = await getCampaignPacing(email.campaign_id);
  const limit = effectiveLimit(pacing.hourly_limit, config.MAX_EMAILS_PER_HOUR_PER_SENDER);
  const slot = await acquireSendSlot(sender.id, limit);
  if (!slot.allowed) {
    return rescheduleRateLimited(
      job, token, email, sender, slot, limit, pacing.delay_between_ms, pacing.start_time.getTime(),
    );
  }

  // (b) per-sender minimum delay between sends, enforced across all workers via Redis.
  if (config.MIN_DELAY_BETWEEN_EMAILS_MS > 0) {
    const gate = await redis.set(`sender-gate:${sender.id}`, '1', 'PX', config.MIN_DELAY_BETWEEN_EMAILS_MS, 'NX');
    if (gate === null) {
      const remainingMs = Math.max(await redis.pttl(`sender-gate:${sender.id}`), 1);
      // The provider was never hit, so give the hourly slot back to keep the counter accurate.
      await refundSendSlot(slot);
      await releaseEmail(email.id);
      logger.info(`GATE sender ${sender.email} busy, ${email.recipient} delayed ${remainingMs}ms`);
      await delayJob(job, token, remainingMs);
    }
  }

  // (c) send
  let info;
  try {
    info = await transporter.sendMail({
      from: sender.email,
      to: email.recipient,
      subject: email.subject,
      html: email.body, // sanitized HTML, stored that way when the campaign was created
      text: htmlToText(email.body),
      attachments: await getCampaignAttachments(email.campaign_id),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // (e) permanent error: no retry, and the hourly slot is NOT refunded (the provider was hit).
    if (isPermanentError(err)) {
      await markFailed(email.id, message);
      trackEmailChange(email.id);
      logger.warn(`FAILED ${email.recipient} via ${sender.email} (permanent): ${message}`);
      throw new UnrecoverableError(message);
    }
    // (f) transient error: final attempt fails the email, otherwise let BullMQ retry with backoff.
    if (email.attempts >= config.EMAIL_JOB_ATTEMPTS) {
      await markFailed(email.id, message);
      trackEmailChange(email.id);
      logger.warn(`FAILED ${email.recipient} via ${sender.email} (gave up after ${email.attempts} attempts): ${message}`);
      throw new UnrecoverableError(message);
    }
    await requeueEmail(email.id, message);
    logger.warn(`RETRY ${email.recipient} via ${sender.email} (attempt ${email.attempts}): ${message}`);
    throw err;
  }

  // (d) success. Not inside the try above: a failed DB write must never look like a failed send.
  const preview = nodemailer.getTestMessageUrl(info);
  await withRetries(() => markSent(email.id, info.messageId, preview || null), MARK_SENT_ATTEMPTS);
  trackEmailChange(email.id);
  logger.info({ previewUrl: preview || undefined }, `SENT ${email.recipient} via ${sender.email}`);
}

export function startWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(config.QUEUE_NAME, processEmail, {
    connection: createRedisConnection(),
    concurrency: config.WORKER_CONCURRENCY,
  });

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'job failed');
  });
  worker.on('stalled', (jobId) => {
    logger.warn(`STALLED job ${jobId} (worker likely crashed mid-send), BullMQ will re-run it`);
  });
  worker.on('error', (err) => {
    logger.error({ err }, 'worker error');
  });

  logger.info(
    { concurrency: config.WORKER_CONCURRENCY, minDelayMs: config.MIN_DELAY_BETWEEN_EMAILS_MS },
    'worker started',
  );
  return worker;
}
