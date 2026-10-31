import { Router } from 'express';
import { emailQueue } from '../scheduler/queue.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const queueRouter = Router();

// Feeds the dashboard stats strip. Counts are for the whole queue (one queue serves all users).
queueRouter.get(
  '/counts',
  asyncHandler(async (_req, res) => {
    const counts = await emailQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    res.json({
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    });
  }),
);
