import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// BullMQ requires maxRetriesPerRequest: null on connections used by Workers.
export function createRedisConnection(): Redis {
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on('error', (err) => {
    logger.error({ err }, 'redis connection error');
  });
  return connection;
}

// Shared connection: Queue, sender gate, health check. Workers get their own via createRedisConnection().
export const redis = createRedisConnection();
