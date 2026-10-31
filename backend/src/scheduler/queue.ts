import { Queue } from 'bullmq';
import { config } from '../config.js';
import { redis } from '../lib/redis.js';
import { logger } from '../utils/logger.js';

export interface EmailJobData {
  emailId: string;
}

export interface SchedulableEmail {
  id: string;
  scheduled_at: Date;
}

const ENQUEUE_CHUNK_SIZE = 500;
// Retention of finished jobs in Redis (the emails table is the durable record).
const COMPLETED_JOB_MAX_AGE_SECONDS = 24 * 60 * 60;
const COMPLETED_JOB_MAX_COUNT = 1000;

export const emailQueue = new Queue<EmailJobData>(config.QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: config.EMAIL_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: config.EMAIL_JOB_BACKOFF_MS },
    removeOnComplete: { age: COMPLETED_JOB_MAX_AGE_SECONDS, count: COMPLETED_JOB_MAX_COUNT },
    removeOnFail: false,
  },
});

function jobFor(email: SchedulableEmail) {
  return {
    name: 'send-email',
    data: { emailId: email.id },
    opts: {
      // jobId = email id: adding the same email twice is a no-op in BullMQ.
      jobId: email.id,
      delay: Math.max(0, email.scheduled_at.getTime() - Date.now()),
    },
  };
}

export async function enqueueEmail(email: SchedulableEmail): Promise<void> {
  const { name, data, opts } = jobFor(email);
  await emailQueue.add(name, data, opts);
  logger.info(`Job ${email.id} scheduled for ${email.scheduled_at.toISOString()}`);
}

export async function enqueueEmails(emails: SchedulableEmail[]): Promise<number> {
  for (let i = 0; i < emails.length; i += ENQUEUE_CHUNK_SIZE) {
    const chunk = emails.slice(i, i + ENQUEUE_CHUNK_SIZE);
    await emailQueue.addBulk(chunk.map(jobFor));
    for (const email of chunk) {
      logger.info(`Job ${email.id} scheduled for ${email.scheduled_at.toISOString()}`);
    }
  }
  return emails.length;
}
