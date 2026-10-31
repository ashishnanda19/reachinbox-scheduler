import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Router } from 'express';
import { emailQueue } from '../scheduler/queue.js';

export const BULL_BOARD_PATH = '/admin/queues';

export function createBullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  return serverAdapter.getRouter() as Router;
}
