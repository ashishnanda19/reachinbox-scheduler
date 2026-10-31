import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { emailQueue, enqueueEmails, type SchedulableEmail } from './queue.js';

const BATCH_SIZE = 1000;
const JOB_LOOKUP_CONCURRENCY = 100;

/** Does a usable BullMQ job exist for this email? Dead (completed/failed) jobs are cleared so it can be re-added. */
async function hasLiveJob(emailId: string): Promise<boolean> {
  const job = await emailQueue.getJob(emailId);
  if (!job) return false;

  const state = await job.getState();
  if (state === 'completed' || state === 'failed') {
    // The row is still 'scheduled', so this job's outcome never reached the DB. Drop it so jobId is free again.
    await job.remove();
    return false;
  }
  return true;
}

/**
 * Runs on every worker boot. Postgres is the source of truth, Redis is the delivery mechanism:
 *  (a) claims left in 'processing' by a crashed worker are reset to 'scheduled';
 *  (b) every 'scheduled' email without a BullMQ job (Redis wipe, failed enqueue) gets one back.
 * Adding is idempotent (jobId = email id), so concurrent reconcilers on several instances are safe.
 */
export async function reconcile(): Promise<{ scheduled: number; reenqueued: number; staleReset: number }> {
  const stale = await pool.query(
    `UPDATE emails
        SET status = 'scheduled', processing_started_at = NULL
      WHERE status = 'processing'
        AND (processing_started_at IS NULL
             OR processing_started_at <= now() - ($1::int * interval '1 millisecond'))`,
    [config.STALE_PROCESSING_MS],
  );
  const staleReset = stale.rowCount ?? 0;

  let scheduled = 0;
  let reenqueued = 0;
  let lastId = '00000000-0000-0000-0000-000000000000';

  for (;;) {
    const { rows } = await pool.query<SchedulableEmail>(
      `SELECT id, scheduled_at FROM emails
        WHERE status = 'scheduled' AND id > $1
        ORDER BY id LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (rows.length === 0) break;
    scheduled += rows.length;
    lastId = rows[rows.length - 1]!.id;

    const missing: SchedulableEmail[] = [];
    for (let i = 0; i < rows.length; i += JOB_LOOKUP_CONCURRENCY) {
      const slice = rows.slice(i, i + JOB_LOOKUP_CONCURRENCY);
      const live = await Promise.all(slice.map((row) => hasLiveJob(row.id)));
      slice.forEach((row, index) => {
        if (!live[index]) missing.push(row);
      });
    }
    reenqueued += await enqueueEmails(missing);
  }

  logger.info({ reenqueued }, `Reconciled ${scheduled} scheduled emails, reset ${staleReset} stale`);
  return { scheduled, reenqueued, staleReset };
}
