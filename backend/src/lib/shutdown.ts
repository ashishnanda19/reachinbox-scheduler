import { logger } from '../utils/logger.js';

/** Runs `close` once on SIGINT/SIGTERM. Closing the worker inside it lets in-flight jobs finish. */
export function registerShutdown(close: () => Promise<void>): void {
  let shuttingDown = false;

  const handle = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    try {
      await close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void handle('SIGINT'));
  process.on('SIGTERM', () => void handle('SIGTERM'));
}
