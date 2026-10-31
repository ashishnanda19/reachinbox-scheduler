import { Router } from 'express';
import { pool } from '../db/pool.js';
import { currentUser } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const statsRouter = Router();

statsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{ scheduled: number; sent: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('scheduled', 'processing'))::int AS scheduled,
              count(*) FILTER (WHERE status = 'sent')::int AS sent,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM emails WHERE user_id = $1`,
      [currentUser(req).id],
    );
    res.json(rows[0]);
  }),
);
