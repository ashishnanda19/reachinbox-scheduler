import { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

// An idle client erroring (e.g. Postgres restart) must not crash the process.
pool.on('error', (err) => {
  logger.error({ err }, 'unexpected error on idle postgres client');
});
