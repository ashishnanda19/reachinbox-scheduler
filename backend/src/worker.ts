import { pool } from './db/pool.js';
import { redis } from './lib/redis.js';
import { registerShutdown } from './lib/shutdown.js';
import { emailQueue } from './scheduler/queue.js';
import { startScheduler } from './scheduler/start.js';
import { initSearch } from './services/search.js';
import { logger } from './utils/logger.js';

void initSearch(); // create the index if missing; never blocks or fails boot

const worker = await startScheduler().catch((err) => {
  logger.error({ err }, 'failed to start scheduler');
  process.exit(1);
});

registerShutdown(async () => {
  await worker.close(); // waits for in-flight jobs to finish
  await emailQueue.close();
  await pool.end();
  await redis.quit();
});
