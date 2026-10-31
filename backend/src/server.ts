import type { Worker } from 'bullmq';
import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { registerShutdown } from './lib/shutdown.js';
import { emailQueue, type EmailJobData } from './scheduler/queue.js';
import { startScheduler } from './scheduler/start.js';
import { initSearch } from './services/search.js';
import { logger } from './utils/logger.js';

void initSearch(); // create the index if missing; never blocks or fails boot

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, workerInApi: config.RUN_WORKER_IN_API }, 'api listening');
});

let worker: Worker<EmailJobData> | undefined;
if (config.RUN_WORKER_IN_API) {
  startScheduler()
    .then((started) => {
      worker = started;
    })
    .catch((err) => {
      logger.error({ err }, 'failed to start scheduler');
      process.exit(1);
    });
}

registerShutdown(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections();
  });
  await worker?.close(); // waits for in-flight jobs to finish
  await emailQueue.close();
  await pool.end();
  await redis.quit();
});
