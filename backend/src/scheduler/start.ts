import type { Worker } from 'bullmq';
import { reconcile } from './reconcile.js';
import type { EmailJobData } from './queue.js';
import { startWorker } from './worker.js';

/** Reconcile first so the worker starts against a consistent queue, then begin consuming. */
export async function startScheduler(): Promise<Worker<EmailJobData>> {
  await reconcile();
  return startWorker();
}
